/**
 * @sip402/server PROOF — SELLER side, Base Sepolia, REAL txs (no mocks).
 *
 * Proves the heart of the `batch-settlement` binding's seller side:
 *   - verify-by-simulation accepts valid commitments (SPEC §6),
 *   - the accumulator stores them (Accumulate, §5.2),
 *   - flush() redeems N commitments in ONE redeemDelegations tx (Redeem, §5.3),
 *     producing N USDC transfers to the seller in that single transaction,
 *   - an over-budget commitment is REJECTED AT VERIFY (simulation reverts).
 *
 * BATCH PARAM SHAPE (resolved from the proven single-redeem encoding):
 *   redeemDelegations({
 *     delegations: [ ctxA, ctxB, ctxC ],   // one permissionContext (leaf-first Hex) per commitment
 *     modes:       [ SingleDefault x3 ],
 *     executions:  [ [transfer(seller, amtA)], [transfer(seller, amtB)], [transfer(seller, amtC)] ],
 *   })
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
  erc20Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { USDC, toUsdcAtoms } from "@sip402/core";
import { openSession, createCommitment, type Commitment } from "@sip402/client";
import {
  CommitmentAccumulator,
  countTransfersTo,
  type SettlementEvent,
} from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not found in .env at repo root");

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const chain = baseSepolia;

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

async function makeFundedSeller(): Promise<{ pk: Hex; address: Address }> {
  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  const ownerWallet = createWalletClient({ account: owner, chain, transport: http(RPC_URL) });
  const h = await ownerWallet.sendTransaction({ to: address, value: parseEther("0.005") });
  await publicClient.waitForTransactionReceipt({ hash: h });
  console.log("    seller EOA:", address, "(funded 0.005 ETH)");
  return { pk, address };
}

async function main() {
  console.log("=".repeat(72));
  console.log("sip402 SERVER PROOF — Base Sepolia (chainId", chain.id + ")");
  console.log("=".repeat(72));
  console.log("Owner EOA:", owner.address);
  console.log("USDC:     ", USDC);

  const ownerEth = await publicClient.getBalance({ address: owner.address });
  console.log("Owner ETH:", formatUnits(ownerEth, 18));
  console.log("Owner USDC:", usd(await usdcBalance(owner.address)));
  if (ownerEth === 0n) throw new Error("Owner EOA has no ETH for gas");

  const checks: Record<string, boolean> = {};

  // ── 1) openSession ($1 cap) ────────────────────────────────────────────────
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
  checks["openSession"] = true;

  // ── 2) seller + accumulator ────────────────────────────────────────────────
  hr();
  console.log("[2] generate seller EOA + accumulator (minBatch $1, won't auto-flush)");
  const seller = await makeFundedSeller();
  const events: SettlementEvent[] = [];
  const accumulator = new CommitmentAccumulator({
    sellerPrivateKey: seller.pk,
    expectedPayTo: seller.address,
    minBatchAtoms: toUsdcAtoms(1), // high so accept() never auto-flushes; we flush() explicitly
    rpcUrl: RPC_URL,
    onEvent: (e) => events.push(e),
  });

  // ── 3) accept 3 commitments ($0.10 each), verify-by-simulation ─────────────
  hr();
  console.log("[3] create + accept 3 commitments ($0.10 each) — verify-by-simulation");
  const commitments: Commitment[] = [];
  for (let i = 0; i < 3; i++) {
    const c = await createCommitment({
      session,
      sellerAddress: seller.address,
      amountAtoms: toUsdcAtoms(0.1),
      rpcUrl: RPC_URL,
    });
    const id = await accumulator.accept(c);
    commitments.push(c);
    console.log(`    accepted #${i + 1}: ${id.slice(0, 18)}…  (${usd(BigInt(c.amount))})`);
  }
  console.log("    pending total:", usd(accumulator.pendingAtoms()));
  checks["3 commitments accepted (verify-by-sim)"] =
    accumulator.pendingAtoms() === toUsdcAtoms(0.3);

  // ── 4) flush() → ONE batch tx with 3 transfers ─────────────────────────────
  hr();
  console.log("[4] flush() — redeem ALL 3 commitments in ONE batch redeemDelegations tx");
  const sellerBefore = await usdcBalance(seller.address);
  const txHash = await accumulator.flush();
  if (!txHash) throw new Error("flush returned null — nothing batched");
  console.log("    BATCH TX:", explorer(txHash));

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex });
  console.log("    receipt status:", receipt.status, " gasUsed:", receipt.gasUsed.toString());
  const transfersToSeller = countTransfersTo(receipt.logs, seller.address);
  console.log("    USDC Transfer(→seller) logs in this ONE tx:", transfersToSeller);

  // poll for balance settle
  let sellerAfter = await usdcBalance(seller.address);
  for (let i = 0; i < 8 && sellerAfter - sellerBefore < toUsdcAtoms(0.3); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    sellerAfter = await usdcBalance(seller.address);
  }
  const delta = sellerAfter - sellerBefore;
  console.log("    seller USDC delta:", usd(delta));
  checks["BATCH: 3 transfers in 1 tx"] =
    receipt.status === "success" && transfersToSeller === 3;
  checks["BATCH: seller received $0.30 total"] = delta === toUsdcAtoms(0.3);
  checks["settle event emitted with 3 commitmentIds"] =
    events.some((e) => e.type === "settle" && e.commitmentIds.length === 3 && e.txHash === txHash);

  // ── 5) over-budget commitment → rejected AT VERIFY ─────────────────────────
  hr();
  console.log("[5] over-budget: 4th commitment $0.95 ($0.30 used + $0.95 = $1.25 > $1 cap)");
  console.log("    → accept() must REJECT it at verify (simulation reverts)");
  const cOver = await createCommitment({
    session,
    sellerAddress: seller.address,
    amountAtoms: toUsdcAtoms(0.95),
    rpcUrl: RPC_URL,
  });
  let rejected = false;
  let reason = "";
  try {
    await accumulator.accept(cOver);
  } catch (err) {
    rejected = true;
    reason = err instanceof Error ? err.message : String(err);
  }
  if (rejected) {
    console.log("    OVER-BUDGET REJECTED AT VERIFY:", reason);
  } else {
    console.log("    !! over-budget commitment was ACCEPTED unexpectedly");
  }
  checks["over-budget rejected at verify"] = rejected;
  checks["pending unchanged after rejection"] = accumulator.pendingAtoms() === 0n;

  // ── 6) Summary ─────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("SERVER PROOF SUMMARY");
  console.log("=".repeat(72));
  console.log("Treasury:", session.treasuryAddress);
  console.log("Seller:  ", seller.address);
  console.log("BATCH TX:", txHash ? explorer(txHash) : "(none)");
  console.log("-".repeat(72));
  let allPass = true;
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  [${v ? "PASS" : "FAIL"}] ${k}`);
    if (!v) allPass = false;
  }
  console.log("=".repeat(72));
  if (allPass) {
    console.log("SERVER PROOF: PASS ✔  (real Base Sepolia transactions)");
  } else {
    console.log("SERVER PROOF: FAIL ✗");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nSERVER PROOF FAILED:");
  console.error(e);
  process.exit(1);
});
