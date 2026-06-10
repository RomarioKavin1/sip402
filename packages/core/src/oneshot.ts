/**
 * oneshot.ts — 1Shot relayer JSON-RPC client.
 *
 * Implements the 1Shot relayer API used for gasless ERC-7710 delegation
 * redemption on mainnet (Base, chainId 8453). All methods POST to the relayer
 * endpoint defined in chain.ts (ONESHOT_RELAYER_URL).
 *
 * Methods:
 *   getCapabilities(chainId)                     — relayer_getCapabilities
 *   getFeeData(chainId, token)                   — relayer_getFeeData
 *   send7710Transaction(params)                  — relayer_send7710Transaction
 *   getStatus(taskId)                            — relayer_getStatus
 *
 * NOTE: send7710Transaction and getStatus are for MAINNET use only.
 * getCapabilities/getFeeData can be called on mainnet for configuration checks.
 *
 * ACTUAL API RESPONSE SHAPES (verified 2026-06-13 against live relayer):
 *
 *   getCapabilities("8453") =>
 *     { "8453": { feeCollector, targetAddress, tokens: [{address, symbol, decimals}] } }
 *
 *   getFeeData("8453", usdcAddress) =>
 *     { chainId, token: {decimals, address, symbol, name}, rate, minFee: "0.01",
 *       expiry, gasPrice, feeCollector, targetAddress, context: "<json string>" }
 *
 *   Note: minFee is a DECIMAL string (e.g. "0.01"), NOT integer atoms.
 */

import type { Address, Hex } from "viem";
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

// ---------------------------------------------------------------------------
// Public types (matching actual API response shapes)
// ---------------------------------------------------------------------------

/** Token descriptor returned by getCapabilities. */
export interface RelayerToken {
  address: Address;
  symbol: string;
  decimals: string;
}

/**
 * Per-chain capabilities entry.
 * The getCapabilities response is a map from chainId string to this shape.
 */
export interface ChainCapabilities {
  feeCollector: Address;
  /** The 1Shot target contract address on this chain. */
  targetAddress: Address;
  /** ERC-20 tokens accepted for fees on this chain. */
  tokens: RelayerToken[];
}

/**
 * Result of getCapabilities — a map from chainId string to ChainCapabilities.
 * e.g. { "8453": { feeCollector, targetAddress, tokens } }
 */
export type RelayerCapabilities = Record<string, ChainCapabilities>;

/** Result of getFeeData. minFee is a DECIMAL string (e.g. "0.01" USDC). */
export interface RelayerFeeData {
  chainId: string;
  /** Fee token descriptor. */
  token: { address: Address; symbol: string; decimals: number; name: string };
  /** Exchange rate. */
  rate: number;
  /** Minimum fee amount as a decimal string (NOT integer atoms), e.g. "0.01". */
  minFee: string;
  expiry: number;
  gasPrice: string;
  feeCollector: Address;
  targetAddress: Address;
  /** Opaque JSON string required when submitting a 7710 transaction. */
  context: string;
}

export interface Send7710Params {
  /** Override for the relayer URL (defaults to ONESHOT_RELAYER_URL). */
  relayerUrl?: string;
  /** EVM chain ID as a decimal string (e.g. "8453" for Base mainnet). */
  chainId: string;
  /** The signed permission context (ERC-7710 delegation blob). */
  permissionContext: Hex;
  /** Target contract address for the execution. */
  target: Address;
  /** Encoded calldata for the execution. */
  callData: Hex;
  /** Native value in hex (usually "0x0" for ERC-20 transfers). */
  value?: string;
}

export interface Send7710Result {
  /** Task ID returned by the relayer; use with getStatus() to poll completion. */
  taskId: string;
}

export interface TaskStatus {
  taskId: string;
  status: "pending" | "submitted" | "confirmed" | "failed";
  txHash?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

/**
 * relayer_getCapabilities — returns a map of chain capabilities including
 * supported target addresses and accepted fee tokens.
 *
 * @param chainId  Decimal string chain ID, e.g. "8453" for Base mainnet.
 * @param relayerUrl  Optional override for the relayer URL.
 */
export async function getCapabilities(
  chainId: string,
  relayerUrl: string = ONESHOT_RELAYER_URL
): Promise<RelayerCapabilities> {
  return rpcCall<RelayerCapabilities>(relayerUrl, "relayer_getCapabilities", [chainId]);
}

/**
 * relayer_getFeeData — returns the minimum fee and opaque context string
 * required to submit a 7710 transaction using `token` as the fee currency.
 *
 * Note: minFee is returned as a decimal string (e.g. "0.01"), not integer atoms.
 *
 * @param chainId  Decimal string chain ID.
 * @param token    ERC-20 token address (e.g. USDC on Base mainnet).
 * @param relayerUrl  Optional override for the relayer URL.
 */
export async function getFeeData(
  chainId: string,
  token: Address,
  relayerUrl: string = ONESHOT_RELAYER_URL
): Promise<RelayerFeeData> {
  return rpcCall<RelayerFeeData>(relayerUrl, "relayer_getFeeData", { chainId, token });
}

/**
 * relayer_send7710Transaction — submit an ERC-7710 delegation redemption
 * transaction to the 1Shot relayer for gasless execution.
 *
 * MAINNET ONLY. The relayer executes the transaction and recovers its fee
 * in USDC from the permission context.
 *
 * Returns a taskId that can be polled with getStatus().
 */
export async function send7710Transaction(
  params: Send7710Params
): Promise<Send7710Result> {
  const { relayerUrl = ONESHOT_RELAYER_URL, ...rest } = params;
  return rpcCall<Send7710Result>(relayerUrl, "relayer_send7710Transaction", rest);
}

/**
 * relayer_getStatus — poll the status of a previously submitted 7710 task.
 *
 * @param taskId    The task ID returned by send7710Transaction.
 * @param relayerUrl  Optional relayer URL override.
 */
export async function getStatus(
  taskId: string,
  relayerUrl: string = ONESHOT_RELAYER_URL
): Promise<TaskStatus> {
  return rpcCall<TaskStatus>(relayerUrl, "relayer_getStatus", { taskId });
}
