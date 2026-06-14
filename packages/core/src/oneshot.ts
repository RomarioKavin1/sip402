/**
 * oneshot.ts — 1Shot public relayer JSON-RPC client.
 *
 * Implements the 1Shot relayer API used for gas-abstracted ERC-7710 delegation
 * redemption (gas paid in USDC) on mainnet (Base, chainId 8453). All methods
 * POST to the relayer endpoint defined in chain.ts (ONESHOT_RELAYER_URL).
 *
 * Methods:
 *   getCapabilities(chainIds)                  — relayer_getCapabilities
 *   getFeeData(chainId, token)                 — relayer_getFeeData
 *   estimate7710Transaction(params)            — relayer_estimate7710Transaction
 *   send7710Transaction(params)                — relayer_send7710Transaction
 *   getStatus(taskId)                          — relayer_getStatus
 *
 * NOTE: estimate/send/getStatus are MAINNET use only (the relayer's mainnet
 * endpoint). getCapabilities/getFeeData can be called for configuration checks.
 *
 * PROVEN 2026-06-14 on Base mainnet (oneshot-mainnet-proof.ts):
 *   tx 0x26a44ffedefb113e6a6c1aa266985076684dea9faaea097f92e4f3e1731940e9
 *   — EOA upgraded via EIP-7702 + USDC fee to feeCollector, gas paid by relayer.
 *
 * ACTUAL API RESPONSE SHAPES (verified against live relayer):
 *
 *   getCapabilities(["8453"]) =>
 *     { "8453": { feeCollector, targetAddress, tokens: [{address, symbol, decimals}] } }
 *
 *   estimate7710Transaction(sendParams without context) =>
 *     { success, requiredPaymentAmount: "<atoms>", gasUsed: {"8453":"<n>"},
 *       context: "<signed price-lock>", error? }
 *
 *   send7710Transaction(sendParams + context [+ authorizationList]) => "<taskId hex>"
 *
 *   getStatus({id, logs}) => { id, chainId, status: 100|110|200|400|500,
 *       hash?, receipt?: { transactionHash }, message?, data? }
 *
 *   permissionContext is an ARRAY OF DELEGATION OBJECTS (bigints serialized to
 *   0x-hex via toRelayerJson), NOT an encoded hex blob.
 */

import type { Address, Hex } from "viem";
import { bytesToHex } from "viem/utils";
import { ONESHOT_RELAYER_URL } from "./chain.js";

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let _reqId = 1;

async function rpcCall<T>(
  url: string,
  method: string,
  params: unknown
): Promise<T> {
  const id = _reqId++;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`1Shot HTTP ${res.status}: ${text}`);
  }

  const json: JsonRpcResponse<T> = await res.json();

  if (json.error) {
    throw new Error(
      `1Shot RPC error ${json.error.code}: ${json.error.message}` +
        (json.error.data ? ` — ${JSON.stringify(json.error.data)}` : "")
    );
  }

  if (json.result === undefined) {
    throw new Error(`1Shot RPC returned no result for method ${method}`);
  }

  return json.result;
}

/**
 * Convert a MetaMask delegation struct (with native bigints / Uint8Arrays) into
 * a JSON-safe shape the relayer accepts: bigint -> 0x-hex string, Uint8Array ->
 * hex. Run each signed delegation through this before putting it in
 * `permissionContext`.
 */
export function toRelayerJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(toRelayerJson);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toRelayerJson(v);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public types (matching actual API response shapes)
// ---------------------------------------------------------------------------

/** Token descriptor returned by getCapabilities. */
export interface RelayerToken {
  address: Address;
  symbol?: string;
  name?: string;
  /** May arrive as a numeric string (e.g. "6"). */
  decimals: number | string;
}

/**
 * Per-chain capabilities entry.
 * The getCapabilities response is a map from chainId string to this shape.
 */
export interface ChainCapabilities {
  feeCollector: Address;
  /** The 1Shot redemption account on this chain — the delegation `to` MUST equal this. */
  targetAddress: Address;
  /** ERC-20 tokens accepted for fees on this chain. */
  tokens: RelayerToken[];
}

/** Result of getCapabilities — a map from chainId string to ChainCapabilities. */
export type RelayerCapabilities = Record<string, ChainCapabilities>;

/** Result of getFeeData — a rough pre-bundle quote. */
export interface RelayerFeeData {
  chainId: string;
  token: { address: Address; symbol?: string; decimals: number; name?: string };
  rate: number;
  /** Floor fee in token atoms (≈ $0.01). NOTE: live relayer sometimes returns a
   *  decimal string (e.g. "0.01"); prefer estimate7710Transaction for exact atoms. */
  minFee: string;
  expiry: number;
  gasPrice: Hex;
  feeCollector: Address;
  targetAddress?: Address;
  /** Signed price-lock context; pass verbatim to send7710Transaction.context. */
  context?: string;
}

/** An ERC-7710 delegation object (kit `Delegation` run through toRelayerJson). */
export type RelayerDelegation = Record<string, unknown>;

/** One execution leg of a 7710 bundle. */
export interface Execution7710 {
  target: Address;
  /** wei as decimal or 0x-hex string. */
  value: string;
  data: Hex;
}

/** One delegated transaction within a bundle. */
export interface DelegatedTransaction7710 {
  /** The delegation chain (length 1 for a direct delegation), each as JSON-safe object. */
  permissionContext: RelayerDelegation[];
  executions: Execution7710[];
}

/** An EIP-7702 authorization list entry (for in-flight EOA upgrade, ≤1 per request). */
export interface AuthorizationListEntry {
  address: Address;
  chainId: number | string;
  nonce: number | string;
  r: Hex;
  s: Hex;
  yParity: number | string;
}

/** Params for estimate7710Transaction and send7710Transaction. */
export interface Send7710Params {
  /** Override for the relayer URL (defaults to ONESHOT_RELAYER_URL). */
  relayerUrl?: string;
  /** EVM chain ID as a decimal string (e.g. "8453" for Base mainnet). */
  chainId: string;
  /** Delegated transactions; merged server-side into one redeemDelegations batch. */
  transactions: DelegatedTransaction7710[];
  /** Signed price-lock context from estimate7710Transaction (required on send). */
  context?: string;
  /** At most one EIP-7702 authorization entry (first-use EOA upgrade). */
  authorizationList?: AuthorizationListEntry[];
  /** Optional webhook URL for status events (≤256 chars). */
  destinationUrl?: string;
  /** Optional opaque correlation label (≤256 chars), echoed in status/webhooks. */
  memo?: string;
}

/** Result of estimate7710Transaction. */
export interface Estimate7710Result {
  success: boolean;
  paymentTokenAddress?: Address;
  paymentChain?: number;
  /** Per-chain summed gas units (decimal strings). */
  gasUsed?: Record<string, string>;
  /** Required fee in payment-token atoms (floored at minFee), when success. */
  requiredPaymentAmount?: string;
  /** Signed price-lock quote; pass as params.context on send. */
  context?: string;
  contextByChainId?: Record<string, string>;
  /** Present when success is false. */
  error?: string;
}

/** Status codes returned by getStatus. */
export type RelayerStatusCode = 100 | 110 | 200 | 400 | 500;

export interface TaskStatus {
  id: Hex;
  chainId: string;
  createdAt?: number;
  /** 100 Pending | 110 Submitted | 200 Confirmed | 400 Rejected | 500 Reverted. */
  status: RelayerStatusCode;
  /** Present at 110+ (the on-chain tx hash). */
  hash?: Hex;
  /** Present at 200 (confirmed). */
  receipt?: {
    transactionHash?: Hex;
    blockHash?: Hex;
    blockNumber?: number;
    gasUsed?: string;
    logs?: unknown[];
  };
  /** Present at 400 (rejected). */
  message?: string;
  /** Present at 500 (reverted) — revert data. */
  data?: unknown;
  memo?: string;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * relayer_getCapabilities — returns a map of chain capabilities including the
 * target address (delegation `to`), feeCollector, and accepted fee tokens.
 *
 * @param chainIds   Decimal string chain IDs, e.g. ["8453"] for Base mainnet.
 * @param relayerUrl Optional override for the relayer URL.
 */
export async function getCapabilities(
  chainIds: string | string[],
  relayerUrl: string = ONESHOT_RELAYER_URL
): Promise<RelayerCapabilities> {
  const params = Array.isArray(chainIds) ? chainIds : [chainIds];
  return rpcCall<RelayerCapabilities>(relayerUrl, "relayer_getCapabilities", params);
}

/**
 * relayer_getFeeData — rough pre-bundle quote (gasPrice, rate, minFee, context).
 * Prefer estimate7710Transaction once the signed bundle exists.
 */
export async function getFeeData(
  chainId: string,
  token: Address,
  relayerUrl: string = ONESHOT_RELAYER_URL
): Promise<RelayerFeeData> {
  return rpcCall<RelayerFeeData>(relayerUrl, "relayer_getFeeData", { chainId, token });
}

/**
 * relayer_estimate7710Transaction — synchronous fee quote for a single-chain
 * 7710 bundle. Validates delegations + simulates gas without creating a task.
 * Pass the SAME params as send but WITHOUT `context`. Returns the required fee
 * (in token atoms) and a signed price-lock `context` to pass to send.
 *
 * Check `result.success` before sending — validation failures come back in the
 * result (not always as JSON-RPC errors).
 */
export async function estimate7710Transaction(
  params: Send7710Params
): Promise<Estimate7710Result> {
  const { relayerUrl = ONESHOT_RELAYER_URL, context: _omit, ...rest } = params;
  return rpcCall<Estimate7710Result>(relayerUrl, "relayer_estimate7710Transaction", rest);
}

/**
 * relayer_send7710Transaction — submit an ERC-7710 delegated bundle for gasless
 * execution (gas paid in USDC). MAINNET ONLY. Pass the signed price-lock
 * `context` from estimate7710Transaction. Returns a taskId to poll with getStatus.
 */
export async function send7710Transaction(
  params: Send7710Params
): Promise<Hex> {
  const { relayerUrl = ONESHOT_RELAYER_URL, ...rest } = params;
  return rpcCall<Hex>(relayerUrl, "relayer_send7710Transaction", rest);
}

/**
 * relayer_getStatus — poll the status of a previously submitted 7710 task.
 *
 * @param taskId     The task ID returned by send7710Transaction.
 * @param logs       Include EVM event logs in the receipt (default true).
 * @param relayerUrl Optional relayer URL override.
 */
export async function getStatus(
  taskId: Hex,
  logs: boolean = true,
  relayerUrl: string = ONESHOT_RELAYER_URL
): Promise<TaskStatus> {
  return rpcCall<TaskStatus>(relayerUrl, "relayer_getStatus", { id: taskId, logs });
}

/**
 * Poll getStatus until a terminal status (200/400/500) or timeout. Returns the
 * final status object. Throws on timeout.
 */
export async function pollUntilTerminal(
  taskId: Hex,
  opts: { relayerUrl?: string; intervalMs?: number; timeoutMs?: number } = {}
): Promise<TaskStatus> {
  const { relayerUrl = ONESHOT_RELAYER_URL, intervalMs = 3000, timeoutMs = 5 * 60_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await getStatus(taskId, true, relayerUrl);
    if (s.status === 200 || s.status === 400 || s.status === 500) return s;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`1Shot getStatus timed out for task ${taskId}`);
}
