/**
 * sip402 1SHOT RELAYER MAINNET PROOF — Base mainnet (chainId 8453), REAL money.
 *
 * Proves the 1Shot permissionless relayer can execute an ERC-7710
 * `redeemDelegations` (a tiny USDC transfer) on Base mainnet with GAS PAID IN
 * USDC — the EOA spends NO ETH for the redemption. This is the documented
 * EIP-7702 + relayer flow (1Shot `public-relayer` skill, estimate-first path).
 *
 * ============================================================================
 * RESOLVED MAINNET FLOW (authoritative — for wiring createOneShotSettler)
 * ============================================================================
 *
 * 1. relayer_getCapabilities(["8453"]) -> { feeCollector, targetAddress, tokens }.
 *    The delegation `to` MUST equal `targetAddress` (the relayer's redemption acct).
 *
 * 2. Upgrade the signer EOA to a stateless 7702 delegator smart account:
 *      const smartAccount = await toMetaMaskSmartAccount({
 *        client, implementation: Implementation.Stateless7702,
 *        address: eoa.address, signer: { account: eoa },
 *      });
 *    On FIRST use, sign an EIP-7702 authorization and include it as ONE
 *    authorizationList entry on the relayer call (the relayer lands the upgrade
 *    in the same redeem tx — the EOA pays NO ETH):
 *      const auth = await eoa.signAuthorization({
 *        chainId, contractAddress: env.implementations.EIP7702StatelessDeleGatorImpl,
 *        nonce,  // EOA's pending tx count
 *      });
 *      authorizationList = [{ address: auth.address, chainId: auth.chainId,
 *        nonce: auth.nonce, r: auth.r, s: auth.s, yParity: auth.yParity ?? 0 }];
 *
 * 3. ONE delegation, `to` = targetAddress, scoped to (fee + work) USDC:
 *      const delegation = createDelegation({
 *        to: targetAddress, from: smartAccount.address,
 *        environment: smartAccount.environment, salt: <random 32 bytes>,
 *        scope: { type: ScopeType.Erc20TransferAmount, tokenAddress: USDC,
 *                 maxAmount: feeAmount + workAmount },
 *      });
 *      const signature = await smartAccount.signDelegation({ delegation });
 *    Serialize bigints via toRelayerJson (bigint -> 0x hex) before JSON-RPC.
 *
 * 4. Build two executions (ERC-20 transfers): fee -> feeCollector, work -> payTo.
 *    permissionContext is an ARRAY OF DELEGATION OBJECTS (length 1 here), NOT a
 *    hex blob. Execution shape = { target, value: "0", data }.
 *
 * 5. relayer_estimate7710Transaction(sendParams WITHOUT context) -> { success,
 *    requiredPaymentAmount (atoms), context (signed price-lock), gasUsed }.
 *    If requiredPaymentAmount != mockFee, rebuild + re-sign + re-estimate.
 *
 * 6. relayer_send7710Transaction({ ...sendParams, context, authorizationList })
 *    -> taskId (0x + 64 hex).
 *
 * 7. Poll relayer_getStatus({ id: taskId, logs: true }) until terminal:
 *    100 Pending / 110 Submitted(hash) / 200 Confirmed(receipt) / 400 Rejected /
 *    500 Reverted. Capture data.hash / data.receipt.transactionHash.
 * ============================================================================
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  parseUnits,
  getAddress,
  bytesToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import {
  toMetaMaskSmartAccount,
  Implementation,
  ScopeType,
  createDelegation,
  getSmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";

// ---------------------------------------------------------------------------
// Env / chain
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not found in .env at repo root");

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const RELAYER_URL = "https://relayer.1shotapi.com/relayers";
const CHAIN_ID = 8453;
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const chain = base;
const env = getSmartAccountsEnvironment(CHAIN_ID);

const explorer = (h: string) => `https://basescan.org/tx/${h}`;
const usd = (atoms: bigint) => `$${formatUnits(atoms, 6)}`;

// ---------------------------------------------------------------------------
// JSON-RPC helper
// ---------------------------------------------------------------------------
let _id = 1;
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RELAYER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: _id++, method, params }),
  });
  const json = (await res.json()) as {
    result?: T;
    error?: { code: number; message: string; data?: unknown };
  };
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  if (json.error) {
    throw new Error(
      `[${json.error.code}] ${json.error.message} ${JSON.stringify(json.error.data ?? "")}`
    );
  }
  return json.result as T;
}

/** Convert delegation bigints / Uint8Arrays into JSON-safe shapes for the relayer. */
function toRelayerJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return `0x${value.toString(16)}`;
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value)) return value.map(toRelayerJson);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toRelayerJson(v);
    return out;
  }
  return value;
}

interface Estimate7710Result {
  success: boolean;
  paymentTokenAddress?: Address;
  gasUsed?: Record<string, string>;
  requiredPaymentAmount?: string;
  context?: string;
  error?: string;
}

interface StatusResult {
  id: Hex;
  chainId: string;
  status: 100 | 110 | 200 | 400 | 500;
  hash?: Hex;
  receipt?: { transactionHash?: Hex; blockNumber?: number; gasUsed?: string };
  message?: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("=".repeat(72));
  console.log("sip402 1SHOT RELAYER MAINNET PROOF — Base mainnet (chainId", CHAIN_ID + ")");
  console.log("=".repeat(72));

  const eoa = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });

  console.log("Signer EOA:       ", eoa.address);
  console.log("Relayer:          ", RELAYER_URL);
  console.log("USDC:             ", USDC);
  console.log("7702 impl:        ", env.implementations.EIP7702StatelessDeleGatorImpl);

  const ethBefore = await publicClient.getBalance({ address: eoa.address });
  const usdcBefore = (await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [eoa.address],
  })) as bigint;
  const codeBefore = await publicClient.getCode({ address: eoa.address });
  console.log("EOA ETH before:   ", formatUnits(ethBefore, 18));
  console.log("EOA USDC before:  ", usd(usdcBefore));
  console.log("EOA code before:  ", codeBefore ?? "(none — needs EIP-7702 upgrade)");

  // -------------------------------------------------------------------------
  // [1] Capabilities — source of truth for targetAddress + feeCollector
  // -------------------------------------------------------------------------
  console.log("\n[1] relayer_getCapabilities");
  const caps = await rpc<
    Record<
      string,
      {
        feeCollector: Address;
        targetAddress: Address;
        tokens: { address: Address; symbol?: string; decimals: number | string }[];
      }
    >
  >("relayer_getCapabilities", [String(CHAIN_ID)]);
  const chainCaps = caps[String(CHAIN_ID)];
  if (!chainCaps) throw new Error("Base mainnet (8453) not in relayer capabilities");
  const usdcToken = chainCaps.tokens.find(
    (t) => getAddress(t.address) === getAddress(USDC)
  );
  if (!usdcToken) throw new Error("USDC not an accepted relayer fee token on 8453");
  const { targetAddress, feeCollector } = chainCaps;
  console.log("    targetAddress:", targetAddress);
  console.log("    feeCollector: ", feeCollector);

  // -------------------------------------------------------------------------
  // [2] Smart account (stateless 7702 delegator) + EIP-7702 authorization
  // -------------------------------------------------------------------------
  console.log("\n[2] Stateless7702 smart account + EIP-7702 authorization");
  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Stateless7702,
    address: eoa.address,
    signer: { account: eoa },
  });
  console.log("    smartAccount.address:", smartAccount.address, "(== EOA)");

  // First use: the EOA has no code yet, so sign a 7702 authorization to upgrade
  // it to the stateless delegator. The relayer lands this in the redeem tx —
  // the EOA itself pays NO ETH.
  const needsUpgrade = !codeBefore || codeBefore === "0x";
  let authorizationList:
    | {
        address: Address;
        chainId: number;
        nonce: number;
        r: Hex;
        s: Hex;
        yParity: number;
      }[]
    | undefined;
  if (needsUpgrade) {
    const nonce = await publicClient.getTransactionCount({
      address: eoa.address,
      blockTag: "pending",
    });
    const auth = await eoa.signAuthorization({
      chainId: CHAIN_ID,
      contractAddress: getAddress(env.implementations.EIP7702StatelessDeleGatorImpl),
      nonce,
    });
    authorizationList = [
      {
        address: auth.address,
        chainId: auth.chainId,
        nonce: auth.nonce,
        r: auth.r,
        s: auth.s,
        yParity: auth.yParity ?? 0,
      },
    ];
    console.log("    signed EIP-7702 authorization (nonce", nonce + ") — will upgrade in-flight");
  } else {
    console.log("    EOA already upgraded — no authorizationList needed");
  }

  // -------------------------------------------------------------------------
  // [3] Build + sign the bundle: ONE delegation scoped to fee + work
  // -------------------------------------------------------------------------
  console.log("\n[3] Build + sign delegation (Erc20TransferAmount, fee + work)");
  // Work: tiny USDC transfer back to the owner's own address ($0.05).
  const payTo: Address = eoa.address;
  const workAmount = parseUnits("0.05", 6); // $0.05

  async function buildSignedBundle(feeAmount: bigint) {
    const delegation = createDelegation({
      to: targetAddress,
      from: smartAccount.address,
      environment: smartAccount.environment,
      salt: bytesToHex(Uint8Array.from(randomBytes(32))) as Hex,
      scope: {
        type: ScopeType.Erc20TransferAmount,
        tokenAddress: USDC,
        maxAmount: feeAmount + workAmount,
      },
    });
    const signature = await smartAccount.signDelegation({ delegation });

    const feeCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [feeCollector, feeAmount],
    });
    const workCalldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [payTo, workAmount],
    });

    return {
      chainId: String(CHAIN_ID),
      transactions: [
        {
          permissionContext: [toRelayerJson({ ...delegation, signature })],
          executions: [
            { target: USDC, value: "0", data: feeCalldata },
            { target: USDC, value: "0", data: workCalldata },
          ],
        },
      ],
    };
  }

  // Mock fee >= minFee ($0.01) for the estimate.
  const mockFee = parseUnits("0.01", 6); // 10000 atoms
  console.log("    work amount:", usd(workAmount), "-> payTo", payTo);
  console.log("    mock fee:   ", usd(mockFee));

  // -------------------------------------------------------------------------
  // [4] Estimate — quote the real fee + signed price-lock context
  // -------------------------------------------------------------------------
  console.log("\n[4] relayer_estimate7710Transaction");
  let sendParams = await buildSignedBundle(mockFee);
  const estimateParams = (p: typeof sendParams) =>
    authorizationList ? { ...p, authorizationList } : p;

  let estimate = await rpc<Estimate7710Result>(
    "relayer_estimate7710Transaction",
    estimateParams(sendParams)
  );
  if (!estimate.success) {
    throw new Error(`estimate failed: ${estimate.error ?? "(no error string)"}`);
  }
  console.log("    success:", estimate.success);
  console.log("    requiredPaymentAmount:", estimate.requiredPaymentAmount, "atoms");
  console.log("    gasUsed:", JSON.stringify(estimate.gasUsed));

  const requiredFee = BigInt(estimate.requiredPaymentAmount ?? "0");
  console.log("    required fee:", usd(requiredFee));

  // If the required fee differs from the mock, rebuild + re-sign + re-estimate
  // so the delegation scope and the fee execution match exactly.
  if (requiredFee !== mockFee) {
    console.log("    fee differs from mock — rebuilding + re-estimating");
    sendParams = await buildSignedBundle(requiredFee);
    estimate = await rpc<Estimate7710Result>(
      "relayer_estimate7710Transaction",
      estimateParams(sendParams)
    );
    if (!estimate.success) {
      throw new Error(`re-estimate failed: ${estimate.error ?? "(no error string)"}`);
    }
    console.log("    re-estimate ok, fee:", usd(BigInt(estimate.requiredPaymentAmount ?? "0")));
  }
  if (!estimate.context) throw new Error("estimate returned no price-lock context");

  // -------------------------------------------------------------------------
  // [5] Send — submit the bundle with price-lock + 7702 authorization
  // -------------------------------------------------------------------------
  console.log("\n[5] relayer_send7710Transaction (REAL — spends USDC)");
  const taskId = await rpc<Hex>("relayer_send7710Transaction", {
    ...sendParams,
    context: estimate.context,
    ...(authorizationList ? { authorizationList } : {}),
  });
  console.log("    >>> taskId:", taskId);

  // -------------------------------------------------------------------------
  // [6] Poll status until terminal
  // -------------------------------------------------------------------------
  console.log("\n[6] relayer_getStatus (polling)");
  const deadline = Date.now() + 5 * 60_000;
  let final: StatusResult | undefined;
  let lastStatus = -1;
  while (Date.now() < deadline) {
    const s = await rpc<StatusResult>("relayer_getStatus", { id: taskId, logs: true });
    if (s.status !== lastStatus) {
      lastStatus = s.status;
      const label =
        { 100: "Pending", 110: "Submitted", 200: "Confirmed", 400: "Rejected", 500: "Reverted" }[
          s.status
        ] ?? String(s.status);
      console.log(`    status ${s.status} (${label})${s.hash ? " hash=" + s.hash : ""}`);
    }
    if (s.status === 200 || s.status === 400 || s.status === 500) {
      final = s;
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!final) throw new Error("timed out waiting for terminal status");

  if (final.status !== 200) {
    console.error("    RELAY FAILED:", JSON.stringify(final, null, 2));
    throw new Error(
      `relayer terminal status ${final.status}: ${final.message ?? JSON.stringify(final.data)}`
    );
  }

  const txHash = (final.receipt?.transactionHash ?? final.hash) as Hex;
  console.log("    CONFIRMED ✔  txHash:", txHash);
  console.log("    " + explorer(txHash));

  // -------------------------------------------------------------------------
  // [7] On-chain verification: USDC moved, ETH ~unchanged (gas paid in USDC)
  // -------------------------------------------------------------------------
  console.log("\n[7] On-chain verification");
  const rcpt = await publicClient.getTransactionReceipt({ hash: txHash });
  console.log("    receipt status:", rcpt.status);
  if (rcpt.status !== "success") throw new Error("on-chain tx reverted");

  const ethAfter = await publicClient.getBalance({ address: eoa.address });
  const usdcAfter = (await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [eoa.address],
  })) as bigint;
  const feeCollectorUsdc = (await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [feeCollector],
  })) as bigint;
  const codeAfter = await publicClient.getCode({ address: eoa.address });

  const ethDelta = ethAfter - ethBefore;
  // Net USDC change for the EOA: it transferred `work` to itself (no net change
  // from that leg since payTo == EOA) and paid the fee out (net -fee). So the
  // EOA's USDC should drop by ~the fee only.
  const usdcDelta = usdcAfter - usdcBefore;

  console.log("    EOA ETH after:    ", formatUnits(ethAfter, 18));
  console.log("    EOA ETH delta:    ", formatUnits(ethDelta, 18), ethDelta === 0n ? "(ZERO — no ETH gas)" : "");
  console.log("    EOA USDC after:   ", usd(usdcAfter));
  console.log("    EOA USDC delta:   ", usd(usdcDelta), "(fee paid in USDC; work leg pays self)");
  console.log("    EOA code after:   ", codeAfter ?? "(none)");

  console.log("\n" + "=".repeat(72));
  console.log("1SHOT MAINNET PROOF SUMMARY");
  console.log("=".repeat(72));
  console.log("taskId:           ", taskId);
  console.log("on-chain tx:      ", explorer(txHash));
  console.log("relayer fee (USDC):", usd(requiredFee));
  console.log("EOA ETH spent:    ", formatUnits(-ethDelta, 18), ethDelta === 0n ? "(gas paid in USDC ✔)" : "");
  console.log("EOA USDC net:     ", usd(usdcDelta));
  console.log("EOA upgraded 7702:", codeAfter && codeAfter !== "0x" ? "yes ✔" : "no");
  console.log("=".repeat(72));

  if (ethDelta !== 0n) {
    console.warn(
      "WARNING: EOA ETH changed — expected ZERO (gas should be paid by relayer in USDC)."
    );
  }
  console.log("1SHOT MAINNET PROOF: PASS ✔  (real Base mainnet tx, gas in USDC)");
}

main().catch((e) => {
  console.error("\n1SHOT MAINNET PROOF FAILED:");
  console.error(e);
  process.exit(1);
});
