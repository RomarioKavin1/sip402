/**
 * sip402 BINDING PROOF — @sip402/client buyer side, Base Sepolia, REAL txs.
 *
 * Proves the x402 `batch-settlement` capital-backed binding end-to-end with no
 * mocks: the buyer opens a session, pays with commitments (redelegations to the
 * seller), the SELLER redeems them, cumulative draws accumulate, an over-cap
 * draw reverts, an A2A redelegation inserts a hop, and a revoke kills the chain.
 *
 * ============================================================================
 * RESOLVED REDELEGATION API + CHAIN ORDERING (authoritative — for the server)
 * ============================================================================
 *
 * CREATE A REDELEGATION (a delegate extends the chain to a new delegate):
 *   const child = createDelegation({
 *     scope: { type: ScopeType.Erc20PeriodTransfer, tokenAddress, periodAmount,
 *              periodDuration, startDate },
 *     to:   newDelegateAddress,           // seller, or specialist agent
 *     from: parentDelegateAddress,        // the current delegate (an EOA) redelegating
 *     parentDelegation: parentSignedDelegation,   // binds authority = hash(parent)
 *     environment,
 *   });
 *   // The delegator is an EOA (the session agent). It signs with the kit's
 *   // STANDALONE signer (NOT smartAccount.signDelegation), which EIP-712-signs
 *   // with a private key — valid for an EOA delegator:
 *   const signature = await signDelegation({            // exported from the kit root
 *     privateKey, delegation: child,
 *     delegationManager: env.DelegationManager, chainId });
 *   const childSigned = { ...child, signature };
 *
 * PERMISSION CONTEXT = encodeDelegations(chainLeafFirst) where the chain array
 * is ordered LEAF-FIRST: [ leafDelegation, …, rootDelegation ].
 *   e.g. depth-3 commitment chain = [ agent→seller, treasury→agent ]
 *        depth-4 A2A chain        = [ specialist→seller, agent→specialist, treasury→agent ]
 *
 * REDEEM (the SELLER, as msg.sender, pays gas on testnet):
 *   const data = contracts.DelegationManager.encode.redeemDelegations({
 *     delegations: [ permissionContext ],   // OUTER = one PermissionContext per chain;
 *                                           // a PermissionContext is the Hex blob (or Delegation[])
 *                                           // ordered LEAF-FIRST
 *     modes:       [ ExecutionMode.SingleDefault ],
 *     executions:  [[ transfer(seller, amount) ]],
 *   });
 *   sellerWallet.sendTransaction({ to: env.DelegationManager, data });
 *
 * GAS: a depth-3 chain (treasury→agent→specialist→seller) redemption uses
 * ~650k gas on Base Sepolia; set an explicit gas limit (we use 1.5M) — the
 * default estimate path is both flaky for freshly-funded senders and too tight.
 *
 * SALT: each commitment MUST carry a UNIQUE salt (we use its nonce) so it is a
 * DISTINCT leaf with its own enforcer allowance. Without it, repeat commitments
 * to the same (agent, seller, amount, parent) collapse to ONE delegation hash
 * and the second redeem reverts against the leaf cap. createDelegation defaults
 * salt to 0x00. The cumulative ceiling is enforced by the shared ROOT.
 *
 * The ERC20PeriodTransferEnforcer on the ROOT caps cumulative redemptions per
 * period across ALL commitments; an over-cap redeem reverts atomically.
 *
 * REVOKE: owner calls treasury.execute({ target: DelegationManager, value: 0,
 *   callData: disableDelegation(rootDelegation) }) — inner msg.sender = treasury
 *   = the delegator, so the disable is accepted. Subsequent redeems revert.
 * ============================================================================
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatUnits,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  contracts,
  createExecution,
  ExecutionMode,
  getSmartAccountsEnvironment,
  type PermissionContext,
} from "@metamask/smart-accounts-kit";
import { decodeRevertReason } from "@metamask/smart-accounts-kit/utils";

import { USDC, toUsdcAtoms } from "@sip402/core";
import {
  openSession,
  redelegateSession,
  createCommitment,
  revokeSession,
  type Commitment,
} from "../src/index.js";

// ── Env / chain ─────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not found in .env at repo root");

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const chain = baseSepolia;
const env = getSmartAccountsEnvironment(chain.id);

const explorer = (h: string) => `https://sepolia.basescan.org/tx/${h}`;
const usd = (atoms: bigint) => `$${formatUnits(atoms, 6)}`;
const hr = () => console.log("─".repeat(72));

const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
const owner = privateKeyToAccount(PRIVATE_KEY);

function usdcBalance(addr: Address): Promise<bigint> {
  return publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;
}

/** Poll until `addr`'s USDC balance == expected (the public RPC lags writes). */
async function waitForUsdc(addr: Address, expected: bigint, tries = 8): Promise<bigint> {
  let bal = await usdcBalance(addr);
  for (let i = 0; i < tries && bal !== expected; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    bal = await usdcBalance(addr);
  }
  return bal;
}

/**
 * SELLER redeems a commitment: send the full chain (permissionContext) to the
 * DelegationManager, executing transfer(seller, amount) out of the treasury.
 * Returns { ok, txHash } — ok=false when it reverts (pre-flight or mined).
 */
async function sellerRedeem(opts: {
  sellerPrivateKey: Hex;
  permissionContext: Hex;
  seller: Address;
  amount: bigint;
}): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  const { sellerPrivateKey, permissionContext, seller, amount } = opts;

  const callData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [seller, amount],
  });
  const execution = createExecution({ target: USDC, value: 0n, callData });

  const data = contracts.DelegationManager.encode.redeemDelegations({
    delegations: [permissionContext as PermissionContext],
    modes: [ExecutionMode.SingleDefault],
    executions: [[execution]],
  });

  const sellerAccount = privateKeyToAccount(sellerPrivateKey);
  const sellerWallet = createWalletClient({ account: sellerAccount, chain, transport: http(RPC_URL) });

  // Pre-flight via eth_call to surface the revert REASON (e.g. the
  // ERC20PeriodTransferEnforcer cap) instead of an opaque "mined-but-reverted".
  try {
    await publicClient.call({ account: sellerAccount.address, to: env.DelegationManager as Address, data });
  } catch (err) {
    const reason = decodeRevertReason(err);
    return {
      ok: false,
      error: reason ? `${reason.errorName}: ${reason.message}` : (err instanceof Error ? err.message.split("\n")[0] : String(err)),
    };
  }

  try {
    // Explicit gas limit (generous so a deep, depth-4 chain validation fits);
    // bypassing eth_estimateGas avoids a flaky "gas required exceeds allowance
    // (0)" the public node sometimes returns for a freshly-funded sender.
    const txHash = await sellerWallet.sendTransaction({
      to: env.DelegationManager as Address,
      data,
      gas: 1_500_000n,
    });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (rcpt.status === "reverted") return { ok: false, txHash, error: "mined-but-reverted" };
    return { ok: true, txHash };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  }
}

// Generate + fund a seller EOA with ETH so it can pay gas to redeem.
async function makeFundedSeller(label: string): Promise<{ pk: Hex; address: Address }> {
  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  const ownerWallet = createWalletClient({ account: owner, chain, transport: http(RPC_URL) });
  const h = await ownerWallet.sendTransaction({ to: address, value: parseEther("0.005") });
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log(`    ${label} seller:`, address, "(funded 0.005 ETH)");
  return { pk, address };
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(72));
  console.log("sip402 BINDING PROOF — Base Sepolia (chainId", chain.id + ")");
  console.log("=".repeat(72));
  console.log("Owner EOA:        ", owner.address);
  console.log("DelegationManager:", env.DelegationManager);
  console.log("USDC:             ", USDC);

  const ownerEth = await publicClient.getBalance({ address: owner.address });
  console.log("Owner ETH:        ", formatUnits(ownerEth, 18));
  console.log("Owner USDC:       ", usd(await usdcBalance(owner.address)));
  if (ownerEth === 0n) throw new Error("Owner EOA has no ETH for gas");

  const checks: Record<string, boolean> = {};
  const txs: Record<string, string> = {};

  // ─── 1) openSession ($1 cap, 1-day period) ────────────────────────────────
  hr();
  console.log("[1] openSession — cap $1, period 1 day");
  const session = await openSession({
    ownerPrivateKey: PRIVATE_KEY,
    capUsd: 1,
    periodSeconds: 86400,
    rpcUrl: RPC_URL,
  });
  console.log("    treasury:", session.treasuryAddress);
  console.log("    agent:   ", session.agentAddress);
  console.log("    cap:     ", usd(session.capAtoms), "/", session.periodSeconds + "s");
  console.log("    permissionContext len:", session.permissionContext.length, "bytes hex");
  checks["openSession"] = true;

  // ─── 2) commitment #1 ($0.10) → seller redeems ────────────────────────────
  hr();
  console.log("[2] createCommitment $0.10 → SELLER redeems the chain [treasury→agent→seller]");
  const seller = await makeFundedSeller("primary");
  const c1: Commitment = await createCommitment({
    session,
    sellerAddress: seller.address,
    amountAtoms: toUsdcAtoms(0.1),
    rpcUrl: RPC_URL,
  });
  console.log("    commitmentId:", c1.commitmentId);
  console.log("    amount:", usd(BigInt(c1.amount)), " nonce:", c1.nonce.slice(0, 14) + "…");

  const sellerBefore = await usdcBalance(seller.address);
  const r1 = await sellerRedeem({
    sellerPrivateKey: seller.pk,
    permissionContext: c1.permissionContext,
    seller: seller.address,
    amount: toUsdcAtoms(0.1),
  });
  if (r1.ok && r1.txHash) {
    txs["redeem1"] = r1.txHash;
    console.log("    redeem #1:", explorer(r1.txHash));
  } else {
    console.log("    redeem #1 FAILED:", r1.error);
  }
  const sellerAfter1 = await waitForUsdc(seller.address, sellerBefore + toUsdcAtoms(0.1));
  const delta1 = sellerAfter1 - sellerBefore;
  console.log("    seller USDC delta:", usd(delta1));
  checks["commit+redeem#1"] = r1.ok && delta1 === toUsdcAtoms(0.1);

  // ─── 3) commitment #2 ($0.10) cumulative ──────────────────────────────────
  hr();
  console.log("[3] createCommitment #2 $0.10 → redeem (CUMULATIVE, same session)");
  const c2 = await createCommitment({
    session,
    sellerAddress: seller.address,
    amountAtoms: toUsdcAtoms(0.1),
    rpcUrl: RPC_URL,
  });
  console.log("    commitmentId:", c2.commitmentId);
  const r2 = await sellerRedeem({
    sellerPrivateKey: seller.pk,
    permissionContext: c2.permissionContext,
    seller: seller.address,
    amount: toUsdcAtoms(0.1),
  });
  if (r2.ok && r2.txHash) {
    txs["redeem2"] = r2.txHash;
    console.log("    redeem #2:", explorer(r2.txHash));
  } else {
    console.log("    redeem #2 FAILED:", r2.error);
  }
  const sellerAfter2 = await waitForUsdc(seller.address, sellerBefore + toUsdcAtoms(0.2));
  console.log("    seller cumulative delta after 2:", usd(sellerAfter2 - sellerBefore));
  checks["commit+redeem#2(cumulative)"] = r2.ok && sellerAfter2 - sellerBefore === toUsdcAtoms(0.2);

  // ─── 4) over-cap commitment → redeem must REVERT (dry tab) ─────────────────
  hr();
  console.log("[4] over-cap: commitment $0.90 (0.20 used + 0.90 = 1.10 > $1) → expect REVERT");
  // The commitment leaf alone caps at $0.90, but the ROOT period enforcer caps
  // cumulative at $1.00; redeeming $0.90 after $0.20 used exceeds it → revert.
  const cOver = await createCommitment({
    session,
    sellerAddress: seller.address,
    amountAtoms: toUsdcAtoms(0.9),
    rpcUrl: RPC_URL,
  });
  const rOver = await sellerRedeem({
    sellerPrivateKey: seller.pk,
    permissionContext: cOver.permissionContext,
    seller: seller.address,
    amount: toUsdcAtoms(0.9),
  });
  if (!rOver.ok) {
    console.log("    over-cap redeem REVERTED as expected:", rOver.error ?? "mined-but-reverted");
    if (rOver.txHash) console.log("    (tx:", explorer(rOver.txHash) + ")");
    console.log("    DRY-TAB CONFIRMED ✔");
  } else {
    console.log("    !! over-cap redeem SUCCEEDED unexpectedly:", explorer(rOver.txHash!));
  }
  checks["over-cap reverts"] = !rOver.ok;

  // Sanity: a small within-budget commitment still works (0.20+0.10 ≤ 1.00).
  console.log("    within-budget $0.10 after over-cap rejection:");
  const cAfter = await createCommitment({
    session,
    sellerAddress: seller.address,
    amountAtoms: toUsdcAtoms(0.1),
    rpcUrl: RPC_URL,
  });
  const rAfter = await sellerRedeem({
    sellerPrivateKey: seller.pk,
    permissionContext: cAfter.permissionContext,
    seller: seller.address,
    amount: toUsdcAtoms(0.1),
  });
  if (rAfter.ok && rAfter.txHash) {
    txs["redeem3"] = rAfter.txHash;
    console.log("    redeem #3:", explorer(rAfter.txHash));
  } else {
    console.log("    redeem #3 FAILED:", rAfter.error);
  }
  checks["within-budget after over-cap"] = rAfter.ok;

  // ─── 5) redelegateSession (A2A): depth-4 chain ────────────────────────────
  hr();
  console.log("[5] redelegateSession — agent → specialist (cap $0.50), then commit $0.10 → seller");
  const childSession = await redelegateSession({
    parentSession: session,
    childCapUsd: 0.5,
    periodSeconds: 86400,
    rpcUrl: RPC_URL,
  });
  console.log("    specialist agent:", childSession.agentAddress);
  console.log("    specialist cap:  ", usd(childSession.capAtoms));
  console.log("    chain depth:     ", (childSession.chain as unknown[]).length, "delegations (treasury→agent→specialist)");

  const seller2 = await makeFundedSeller("A2A");
  const cA2A = await createCommitment({
    session: childSession,
    sellerAddress: seller2.address,
    amountAtoms: toUsdcAtoms(0.1),
    rpcUrl: RPC_URL,
  });
  console.log("    A2A commitmentId:", cA2A.commitmentId);
  const a2aChainDepth = (childSession.chain as unknown[]).length + 1;
  console.log("    redeeming depth-" + a2aChainDepth, "chain [treasury→agent→specialist→seller]");

  const seller2Before = await usdcBalance(seller2.address);
  const rA2A = await sellerRedeem({
    sellerPrivateKey: seller2.pk,
    permissionContext: cA2A.permissionContext,
    seller: seller2.address,
    amount: toUsdcAtoms(0.1),
  });
  if (rA2A.ok && rA2A.txHash) {
    txs["redeemA2A"] = rA2A.txHash;
    console.log("    A2A redeem:", explorer(rA2A.txHash));
  } else {
    console.log("    A2A redeem FAILED:", rA2A.error);
  }
  const seller2Delta = (await waitForUsdc(seller2.address, seller2Before + toUsdcAtoms(0.1))) - seller2Before;
  console.log("    A2A seller USDC delta:", usd(seller2Delta));
  if (!rA2A.ok) console.log("    A2A revert reason:", rA2A.error);
  checks["A2A depth-4 redeem"] = rA2A.ok && seller2Delta === toUsdcAtoms(0.1);

  // ─── 6) revokeSession → subsequent redeem must REVERT ─────────────────────
  hr();
  console.log("[6] revokeSession (root) — then a fresh commitment redeem must REVERT");
  const revoke = await revokeSession({ session, ownerPrivateKey: PRIVATE_KEY, rpcUrl: RPC_URL });
  txs["revoke"] = revoke.txHash;
  console.log("    revoke tx:", explorer(revoke.txHash));

  const cPostRevoke = await createCommitment({
    session,
    sellerAddress: seller.address,
    amountAtoms: toUsdcAtoms(0.05),
    rpcUrl: RPC_URL,
  });
  const rPost = await sellerRedeem({
    sellerPrivateKey: seller.pk,
    permissionContext: cPostRevoke.permissionContext,
    seller: seller.address,
    amount: toUsdcAtoms(0.05),
  });
  if (!rPost.ok) {
    console.log("    post-revoke redeem REVERTED as expected:", rPost.error ?? "mined-but-reverted");
    console.log("    REVOKE CONFIRMED ✔");
  } else {
    console.log("    !! post-revoke redeem SUCCEEDED — revoke FAILED:", explorer(rPost.txHash!));
  }
  checks["revoke confirmed"] = !rPost.ok;

  // ─── 7) Summary ───────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("BINDING PROOF SUMMARY");
  console.log("=".repeat(72));
  console.log("Treasury:          ", session.treasuryAddress);
  console.log("Agent (session):   ", session.agentAddress);
  console.log("Specialist (A2A):  ", childSession.agentAddress);
  for (const [k, v] of Object.entries(txs)) console.log(`  ${k.padEnd(12)} ${explorer(v)}`);
  console.log("-".repeat(72));
  let allPass = true;
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  [${v ? "PASS" : "FAIL"}] ${k}`);
    if (!v) allPass = false;
  }
  console.log("=".repeat(72));
  if (allPass) {
    console.log("BINDING PROOF: PASS ✔  (real Base Sepolia transactions)");
  } else {
    console.log("BINDING PROOF: FAIL ✗");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nBINDING PROOF FAILED:");
  console.error(e);
  process.exit(1);
});
