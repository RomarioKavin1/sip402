/**
 * sip402 SPLITTER PROOF — @sip402/splitter, Base Sepolia, REAL on-chain transactions.
 *
 * =============================================================================
 * VENICE vs TESTNET NOTE (authoritative)
 * =============================================================================
 * Venice x402 operates on Base MAINNET + Solana only (eip155:8453; confirmed
 * live: its 402 offers exclude eip155:84532). Therefore on testnet (today) this
 * proof uses `localUpstream()` — a deterministic canned-response generator that
 * lets the full payment loop be exercised with REAL Base Sepolia transactions.
 *
 * `veniceUpstream(privateKey)` is the production path for mainnet. Switching is
 * a ONE-LINE change: replace `localUpstream()` with `veniceUpstream(PRIVATE_KEY)`
 * when the environment is Base mainnet.
 *
 * The on-chain logic (delegation, cumulative draws, dry-tab revert) is IDENTICAL
 * between the two paths — this proof validates the real payment rail.
 * =============================================================================
 *
 * What this proof demonstrates:
 *   1. openSession (cap $1) — deploys treasury smart account, funds it with USDC,
 *      creates a periodic Erc20PeriodTransfer delegation treasury → agent.
 *   2. Generate + fund a seller EOA with ETH for gas.
 *   3. createCommitment to the seller for $1 (authorize up to $1).
 *   4. Build a StreamingDrawer (minBatch $0.25) over the commitment.
 *   5. Stream localUpstream tokens, feeding drawer.record(costAtoms) per chunk.
 *      — Each $0.25 batch triggers a REAL redeemDelegations tx on Base Sepolia.
 *      — Expect ~3-4 incremental on-chain draws, each with a real tx hash.
 *      — Print each draw's tx hash + cumulative drawn.
 *   6. Keep recording past $1 total → a draw REVERTS (dry-tab).
 *      — Log "DRY-TAB: draw reverted, stream halted".
 *   7. PASS/FAIL summary with all draw tx hashes.
 *
 * Spend: ≤ ~$1 USDC (testnet, worthless) + a little ETH for seller gas.
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
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { USDC, toUsdcAtoms } from "@sip402/core";
import { openSession, createCommitment } from "@sip402/client";
import { StreamingDrawer, DryTabError } from "../src/streamingDrawer.js";
import { localUpstream } from "../src/upstream.js";
import type { SettlementEvent } from "@sip402/server";

// ── Env setup ────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env at repo root");

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const chain = baseSepolia;

const explorer = (h: string) => `https://sepolia.basescan.org/tx/${h}`;
const usd = (atoms: bigint) => `$${formatUnits(atoms, 6)}`;
const hr = () => console.log("─".repeat(72));

// ── Proof-specific pricing ────────────────────────────────────────────────────
// We use a deliberately high per-token price so that the ~300-400 tokens emitted
// by localUpstream() cross the $0.25 batch threshold ~3-4 times (costing ~$1 total),
// exercising incremental draws without requiring billions of generated tokens.
//
// PROOF_COST_PER_TOKEN: atoms charged per token (regardless of pricing.ts default).
// With ~400 total tokens and $1 cap at $0.25 batches:
//   $0.25 = 250_000 atoms per batch → 250_000 / atoms_per_token tokens per batch
//   Need ~4 batches of 100 tokens each → atoms_per_token = 250_000 / 100 = 2500
// So each token costs 2500 atoms ($0.0025) = $2.50/1k tokens (premium tier).
const PROOF_COST_PER_TOKEN = 2500n; // atoms per token
function proofTokenCost(tokens: number): bigint {
  return BigInt(tokens) * PROOF_COST_PER_TOKEN;
}

async function main() {
  const owner = privateKeyToAccount(PRIVATE_KEY!);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const ownerWallet = createWalletClient({ account: owner, chain, transport: http(RPC_URL) });

  console.log("=".repeat(72));
  console.log("sip402 SPLITTER PROOF — Base Sepolia + localUpstream (Venice deferred to mainnet)");
  console.log("=".repeat(72));
  console.log("Owner EOA:  ", owner.address);
  console.log("RPC:        ", RPC_URL);

  const ownerEth = await publicClient.getBalance({ address: owner.address });
  const ownerUsdc = (await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [owner.address],
  })) as bigint;
  console.log("Owner ETH:  ", formatUnits(ownerEth, 18));
  console.log("Owner USDC: ", usd(ownerUsdc));
  if (ownerEth === 0n) throw new Error("Owner EOA has no ETH for gas");
  if (ownerUsdc < toUsdcAtoms(2)) throw new Error("Owner needs ≥ $2 USDC on Base Sepolia");

  // ── 1) openSession ($1 cap) ────────────────────────────────────────────────
  hr();
  console.log("[1] openSession — cap $1, period 1 day");
  const session = await openSession({
    ownerPrivateKey: PRIVATE_KEY!,
    capUsd: 1,
    periodSeconds: 86400,
    rpcUrl: RPC_URL,
  });
  console.log("    treasury:     ", session.treasuryAddress);
  console.log("    agent:        ", session.agentAddress);
  console.log("    cap:          ", usd(session.capAtoms));

  // ── 2) Seller EOA — generate + fund with ETH ──────────────────────────────
  hr();
  console.log("[2] Generating + funding seller EOA");
  const sellerPk = generatePrivateKey();
  const sellerAccount = privateKeyToAccount(sellerPk);
  const sellerAddress: Address = sellerAccount.address;
  console.log("    seller:       ", sellerAddress);

  const fundHash = await ownerWallet.sendTransaction({
    to: sellerAddress,
    value: parseEther("0.0005"),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  // Poll until balance lands (RPC load balancers can be stale)
  let sellerEth = 0n;
  for (let i = 0; i < 10 && sellerEth === 0n; i++) {
    sellerEth = await publicClient.getBalance({ address: sellerAddress });
    if (sellerEth === 0n) await new Promise((r) => setTimeout(r, 1500));
  }
  console.log("    seller ETH:   ", formatUnits(sellerEth, 18), "(", explorer(fundHash), ")");
  if (sellerEth === 0n) throw new Error("Seller EOA ETH funding failed — no balance after 10 polls");

  // ── 3) createCommitment ($1 authorization to the seller) ──────────────────
  hr();
  console.log("[3] createCommitment — $1 to seller");
  const commitment = await createCommitment({
    session,
    sellerAddress,
    amountAtoms: toUsdcAtoms(1),
    rpcUrl: RPC_URL,
  });
  console.log("    commitmentId: ", commitment.commitmentId);
  console.log("    amount:       ", usd(BigInt(commitment.amount)));
  console.log("    nonce:        ", commitment.nonce.slice(0, 18) + "…");

  // ── 4) StreamingDrawer — minBatch $0.25 ───────────────────────────────────
  hr();
  console.log("[4] StreamingDrawer — minBatch $0.25, proofPrice $0.0025/token");

  const drawEvents: SettlementEvent[] = [];
  const drawTxHashes: string[] = [];
  let dryTabCaught = false;

  const drawer = new StreamingDrawer({
    sellerPrivateKey: sellerPk,
    commitment,
    minBatchAtoms: 250_000n, // $0.25 per draw
    rpcUrl: RPC_URL,
    onEvent: (e) => {
      drawEvents.push(e);
      if (e.type === "settle" && e.txHash) {
        drawTxHashes.push(e.txHash);
        console.log(
          `    DRAW #${drawTxHashes.length}: ${usd(e.amountAtoms)} | cumulative: ${usd(drawer.drawn)} | tx: ${explorer(e.txHash)}`,
        );
      }
    },
  });

  // ── 5) Stream localUpstream tokens + drive draws ──────────────────────────
  hr();
  console.log("[5] Streaming localUpstream tokens (proving real incremental draws)");
  console.log("    Each chunk's cost recorded; at $0.25 accrued → on-chain draw.");
  console.log("    Stream runs until $1 cap is exhausted (dry-tab revert expected).");
  console.log();

  const upstream = localUpstream();
  let totalTokens = 0;
  let totalCostAtoms = 0n;
  let chunkCount = 0;

  // We'll stream localUpstream once, then manually overdraw to force the dry-tab.
  // But first let's see how many tokens the local upstream produces.
  const allChunks: { text: string; tokens: number }[] = [];
  for await (const chunk of upstream.chatStream({
    model: "local",
    messages: [{ role: "user", content: "Stream a response about sip402" }],
  })) {
    allChunks.push(chunk);
    totalTokens += chunk.tokens;
  }
  console.log(`    localUpstream total: ${totalTokens} tokens in ${allChunks.length} chunks`);
  console.log(`    At ${PROOF_COST_PER_TOKEN} atoms/token → total cost: ${usd(BigInt(totalTokens) * PROOF_COST_PER_TOKEN)}`);
  console.log();

  // Feed tokens from the stream into the drawer
  for (const chunk of allChunks) {
    chunkCount++;
    const costAtoms = proofTokenCost(chunk.tokens);
    totalCostAtoms += costAtoms;

    try {
      await drawer.record(costAtoms);
    } catch (err) {
      if (err instanceof DryTabError) {
        dryTabCaught = true;
        console.log(`    DRY-TAB: draw reverted at chunk #${chunkCount}, stream halted`);
        console.log(`    (cumulative drawn: ${usd(drawer.drawn)}, total cost: ${usd(totalCostAtoms)})`);
        break;
      }
      throw err;
    }
  }

  // If the stream didn't exhaust the cap, record more fake cost to force the dry-tab
  if (!dryTabCaught) {
    console.log(`    Stream exhausted without hitting cap. Forcing overdraw to test dry-tab...`);
    // Force an overdraw by recording cost beyond the $1 cap
    let attempts = 0;
    while (!dryTabCaught && attempts < 20) {
      attempts++;
      try {
        await drawer.record(250_000n); // force $0.25 batches until cap
      } catch (err) {
        if (err instanceof DryTabError) {
          dryTabCaught = true;
          console.log(`    DRY-TAB: draw reverted at forced overdraw #${attempts}`);
          console.log(`    (cumulative drawn: ${usd(drawer.drawn)})`);
        } else {
          throw err;
        }
      }
    }
  }

  // Finalize (flush any remaining if not dry)
  if (!dryTabCaught) {
    try {
      const finalEvent = await drawer.finalize();
      if (finalEvent?.txHash) {
        console.log(`    FINAL DRAW: ${usd(finalEvent.amountAtoms)} | tx: ${explorer(finalEvent.txHash)}`);
      }
    } catch (err) {
      if (err instanceof DryTabError) {
        dryTabCaught = true;
        console.log(`    DRY-TAB: draw reverted on finalize`);
      } else {
        throw err;
      }
    }
  }

  // ── 6) Verify seller received USDC ────────────────────────────────────────
  hr();
  console.log("[6] Verifying seller USDC balance");
  // The drawer waits for each draw's receipt, but the public RPC's balanceOf node
  // can lag behind the node that served the receipt. Reconcile: re-read until the
  // balance reflects all confirmed draws (drawer.drawn), or give up after a few tries.
  const readSellerUsdc = async () =>
    (await publicClient.readContract({
      address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [sellerAddress],
    })) as bigint;
  let sellerUsdc = await readSellerUsdc();
  for (let i = 0; i < 6 && sellerUsdc < drawer.drawn; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    sellerUsdc = await readSellerUsdc();
  }
  console.log("    seller USDC received:", usd(sellerUsdc));
  console.log("    draws confirmed:", drawTxHashes.length);
  console.log("    total drawn (meter):", usd(drawer.drawn));

  // ── 7) Summary ────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("SPLITTER PROOF SUMMARY");
  console.log("=".repeat(72));
  console.log("Session treasury:  ", session.treasuryAddress);
  console.log("Session agent:     ", session.agentAddress);
  console.log("Seller EOA:        ", sellerAddress);
  console.log("Cap:               ", usd(session.capAtoms));
  console.log("MinBatch:           $0.25 (250_000 atoms)");
  console.log("Upstream:           localUpstream (Venice deferred to mainnet)");
  console.log(`Total tokens:       ${totalTokens}`);
  console.log(`Total draws:        ${drawTxHashes.length}`);
  console.log(`Total drawn:        ${usd(drawer.drawn)}`);
  console.log(`Seller received:    ${usd(sellerUsdc)}`);
  console.log();
  for (let i = 0; i < drawTxHashes.length; i++) {
    console.log(`  Draw #${i + 1}: ${explorer(drawTxHashes[i]!)}`);
  }
  console.log();

  const drawsOk = drawTxHashes.length >= 3;
  const dryTabOk = dryTabCaught;
  const balanceOk = sellerUsdc >= 500_000n; // at least $0.50 received

  console.log(`  [${drawsOk ? "PASS" : "FAIL"}] ≥3 incremental on-chain draws (got ${drawTxHashes.length})`);
  console.log(`  [${dryTabOk ? "PASS" : "FAIL"}] DRY-TAB: draw reverted at cap`);
  console.log(`  [${balanceOk ? "PASS" : "FAIL"}] Seller received ≥ $0.50 USDC (got ${usd(sellerUsdc)})`);

  console.log("=".repeat(72));
  const allPass = drawsOk && dryTabOk && balanceOk;
  if (allPass) {
    console.log("SPLITTER PROOF: PASS ✔  (real Base Sepolia transactions)");
  } else {
    console.log("SPLITTER PROOF: FAIL ✗");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nSPLITTER PROOF FAILED:");
  console.error(e);
  process.exit(1);
});
