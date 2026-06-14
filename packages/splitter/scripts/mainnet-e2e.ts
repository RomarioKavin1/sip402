/**
 * sip402 MAINNET END-TO-END PROOF — Base mainnet (chainId 8453), REAL money.
 *
 * Proves the full sip402 thesis with live funds on Base mainnet:
 *   An agent streams REAL Venice AI inference and pays for it PER TOKEN via
 *   gasless, 1Shot-relayer-settled USDC draws — the owner EOA spends ZERO ETH
 *   for the metered payments (gas is paid by the 1Shot relayer in USDC).
 *
 * Flow:
 *   [0] Read owner EOA balances (ETH + USDC), confirm 7702-upgraded.
 *   [1] Top up Venice ONCE ($5) iff balance insufficient (autoTopUp), log balance.
 *   [2] Generate a fresh "provider" seller address to receive metered payments.
 *   [3] Stream a REAL Venice chatStream completion (llama-3.3-70b, short prompt);
 *       print the streamed text so it's visibly real AI output.
 *   [4] Meter cost per token (pricing.ts). Every ~$0.02 of accrued cost, make a
 *       1Shot-settled draw via createOneShotSettler({ ownerAccount }).settle({...})
 *       paying the provider. Print each draw's taskId + on-chain tx hash + URL.
 *       Cap total draw value ≤ ~$0.30 (3-5 draws).
 *   [5] Verify on-chain: each settle tx succeeded; owner ETH unchanged (gasless);
 *       USDC moved to provider + fee to 1Shot feeCollector.
 *   [6] PASS summary: real Venice text + N gasless 1Shot draws on mainnet.
 *
 * Spend: one-time $5 Venice top-up (becomes reusable Venice balance) + ≤ ~$0.30
 *        of metered 1Shot draws (work + relayer fees). Total ≤ ~$5.50.
 *
 * Run:  SIP_NETWORK=base pnpm exec tsx scripts/mainnet-e2e.ts
 *
 * NOTE: drives createOneShotSettler directly (not StreamingDrawer). The
 * OneShotSettler signs its OWN delegation from the owner EOA and settles
 * gaslessly through the 1Shot relayer, so no buyer commitment chain is needed —
 * this is the proven mainnet payment rail (packages/core/src/settle.ts,
 * scripts/oneshot-mainnet-proof.ts, proven tx 0x26a44ffe…).
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  http,
  formatUnits,
  erc20Abi,
  type Hex,
  type Address,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { base } from "viem/chains";

import { createOneShotSettler, ONESHOT_FEE_COLLECTOR } from "@sip402/core";
import { veniceUpstream } from "../src/upstream.js";

// ── Env / chain ───────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env at repo root");

if (process.env.SIP_NETWORK !== "base") {
  throw new Error("This is a MAINNET proof — run with SIP_NETWORK=base");
}

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const VENICE_MODEL = "llama-3.3-70b";

// Demo metering: cross ~$0.02 of cost a few times → 3-5 draws, total ≤ ~$0.30.
//
// The reseller bills the buyer a marked-up per-token RESALE price for the Venice
// inference it streams (its retail price; what it paid Venice is its cost). With a
// short ~100-token completion, RESALE_ATOMS_PER_TOKEN is sized so the metered
// resale cost crosses the $0.02 draw threshold ~4-5 times (total work ≤ ~$0.10),
// exercising several incremental gasless 1Shot draws on a real stream.
const RESALE_ATOMS_PER_TOKEN = 800n; // $0.0008/token = $0.80/1k tokens (retail)
const DRAW_THRESHOLD_ATOMS = 20_000n; // $0.02 accrued resale cost → one 1Shot draw
const MAX_DRAWS = 5; // hard cap on number of draws (keeps total ≤ ~$0.30 work)

const explorer = (h: string) => `https://basescan.org/tx/${h}`;
const usd = (atoms: bigint) => `$${formatUnits(atoms, 6)}`;
const hr = () => console.log("─".repeat(72));

async function main() {
  console.log("=".repeat(72));
  console.log("sip402 MAINNET E2E — REAL Venice inference paid per-token via 1Shot draws");
  console.log("=".repeat(72));

  const owner = privateKeyToAccount(PRIVATE_KEY!);
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });

  const readUsdc = async (a: Address) =>
    (await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [a],
    })) as bigint;

  // ── [0] Owner balances + 7702 state ─────────────────────────────────────────
  const ownerEthBefore = await publicClient.getBalance({ address: owner.address });
  const ownerUsdcBefore = await readUsdc(owner.address);
  const ownerCode = await publicClient.getCode({ address: owner.address });
  console.log("Owner EOA:        ", owner.address);
  console.log("RPC:              ", RPC_URL);
  console.log("Owner ETH:        ", formatUnits(ownerEthBefore, 18));
  console.log("Owner USDC:       ", usd(ownerUsdcBefore));
  console.log(
    "Owner 7702 code:  ",
    ownerCode && ownerCode !== "0x" ? `${ownerCode.slice(0, 12)}… (upgraded ✔)` : "(none)"
  );

  // ── [1] Venice top-up (one-time $5 if insufficient) ─────────────────────────
  hr();
  console.log("[1] Venice balance + one-time top-up");
  const { VeniceClient } = await import("venice-x402-client");
  const venice = new VeniceClient(PRIVATE_KEY!, { autoTopUp: { enabled: false, amount: 0 } });
  console.log("    Venice wallet:", venice.address);

  let bal = await venice.getBalance();
  console.log("    balanceUsd:", bal.balanceUsd, "| canConsume:", bal.canConsume, "| minTopUp:", bal.minimumTopUpUsd);

  if (!bal.canConsume) {
    const topUp = Math.max(5, bal.minimumTopUpUsd || 5);
    console.log(`    Insufficient — performing ONE-TIME $${topUp} USDC top-up from owner EOA…`);
    await venice.topUp(topUp);
    bal = await venice.getBalance();
    console.log("    after top-up — balanceUsd:", bal.balanceUsd, "| canConsume:", bal.canConsume);
    if (!bal.canConsume) throw new Error("Venice still cannot consume after top-up");
  } else {
    console.log("    Sufficient balance — no top-up needed.");
  }

  // ── [2] Provider seller address ─────────────────────────────────────────────
  hr();
  console.log("[2] Provider (seller) address — receives the metered payments");
  const providerAddress: Address = privateKeyToAccount(generatePrivateKey()).address;
  console.log("    provider:", providerAddress);
  const providerUsdcBefore = await readUsdc(providerAddress);

  // ── [3] + [4] Stream real Venice inference, meter, settle via 1Shot ─────────
  hr();
  console.log("[3] Streaming REAL Venice inference (model:", VENICE_MODEL + ")");
  const settler = createOneShotSettler({ ownerAccount: owner, rpcUrl: RPC_URL });
  const feeCollector = ONESHOT_FEE_COLLECTOR as Address;
  const feeCollectorBefore = await readUsdc(feeCollector);

  const upstream = veniceUpstream(PRIVATE_KEY!);
  const prompt = "In two short sentences, explain what a stablecoin micropayment is.";

  type Draw = { idx: number; atoms: bigint; taskId?: string; txHash: string };
  const draws: Draw[] = [];
  let fullText = "";
  let totalTokens = 0;
  let accrued = 0n; // metered-but-not-yet-drawn cost
  let drawnTotal = 0n;
  let capped = false;

  console.log("    prompt:", JSON.stringify(prompt));
  console.log("\n    ── Venice output (live) ──");
  process.stdout.write("    ");

  async function settleDraw(atoms: bigint): Promise<void> {
    const idx = draws.length + 1;
    console.log(`\n\n[4] Draw #${idx}: settling ${usd(atoms)} to provider via 1Shot relayer (gasless)…`);
    const res = await settler.settle({ payTo: providerAddress, atoms });
    drawnTotal += atoms;
    draws.push({ idx, atoms, txHash: res.txHash });
    console.log(`    Draw #${idx} CONFIRMED ✔  amount=${usd(atoms)}`);
    console.log(`      on-chain tx: ${explorer(res.txHash)}`);
    process.stdout.write("    "); // re-indent for continued stream
  }

  for await (const chunk of upstream.chatStream({
    model: VENICE_MODEL,
    messages: [{ role: "user", content: prompt }],
  })) {
    fullText += chunk.text;
    totalTokens += chunk.tokens;
    process.stdout.write(chunk.text);

    if (capped) continue; // keep draining the stream but stop drawing once capped
    accrued += BigInt(chunk.tokens) * RESALE_ATOMS_PER_TOKEN;

    // Drain accrued cost in threshold-sized batches. Venice may deliver the whole
    // completion in one (or few) large chunks, so a single chunk can fund several
    // draws — settle one $0.02 batch per threshold crossing until below threshold.
    while (!capped && accrued >= DRAW_THRESHOLD_ATOMS) {
      accrued -= DRAW_THRESHOLD_ATOMS;
      await settleDraw(DRAW_THRESHOLD_ATOMS);
      if (draws.length >= MAX_DRAWS) {
        capped = true;
        console.log(`\n    [cap] Reached ${MAX_DRAWS} draws — stop drawing, keep streaming text.`);
        process.stdout.write("    ");
      }
    }
  }

  // Flush a final partial batch if we still have headroom (and accrued cost).
  if (!capped && accrued > 0n) {
    await settleDraw(accrued);
    accrued = 0n;
  }

  console.log("\n    ── end Venice output ──\n");

  // ── [5] On-chain verification ───────────────────────────────────────────────
  hr();
  console.log("[5] On-chain verification");

  // Re-read with a few polls (balanceOf node can lag the receipt node).
  const expectProvider = providerUsdcBefore + drawnTotal;
  let providerUsdcAfter = await readUsdc(providerAddress);
  for (let i = 0; i < 6 && providerUsdcAfter < expectProvider; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    providerUsdcAfter = await readUsdc(providerAddress);
  }
  const ownerEthAfter = await publicClient.getBalance({ address: owner.address });
  const ownerUsdcAfter = await readUsdc(owner.address);
  const feeCollectorAfter = await readUsdc(feeCollector);

  const ethDelta = ownerEthAfter - ownerEthBefore;
  const ownerUsdcDelta = ownerUsdcBefore - ownerUsdcAfter; // amount owner paid out
  const providerDelta = providerUsdcAfter - providerUsdcBefore;
  const feeDelta = feeCollectorAfter - feeCollectorBefore;

  console.log("    Owner ETH delta:    ", formatUnits(ethDelta, 18), ethDelta === 0n ? "(ZERO — gasless ✔)" : "");
  console.log("    Owner USDC paid:    ", usd(ownerUsdcDelta), "(work draws + relayer fees + $5 Venice top-up)");
  console.log("    Provider USDC recv: ", usd(providerDelta), "(expected", usd(drawnTotal) + ")");
  console.log("    FeeCollector delta: ", usd(feeDelta), "(1Shot relayer fees, paid in USDC)");

  // ── [6] Summary ─────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log("MAINNET E2E SUMMARY");
  console.log("=".repeat(72));
  console.log("Venice model:       ", VENICE_MODEL);
  console.log("Venice tokens (est):", totalTokens);
  console.log("Real Venice text:   ", JSON.stringify(fullText.slice(0, 200)) + (fullText.length > 200 ? "…" : ""));
  console.log("1Shot draws settled:", draws.length);
  console.log("Total drawn (work): ", usd(drawnTotal));
  console.log("Provider received:  ", usd(providerDelta));
  console.log("Owner ETH spent:    ", formatUnits(-ethDelta, 18), ethDelta === 0n ? "(gasless ✔)" : "");
  console.log("Owner 7702-upgraded:", ownerCode && ownerCode !== "0x" ? "yes ✔" : "no");
  console.log();
  for (const d of draws) {
    console.log(`  Draw #${d.idx}: ${usd(d.atoms)} → provider | ${explorer(d.txHash)}`);
  }
  console.log();

  const veniceOk = fullText.trim().length > 20;
  const drawsOk = draws.length >= 3;
  const gaslessOk = ethDelta === 0n;
  const providerOk = providerDelta >= drawnTotal; // provider got >= what we drew

  console.log(`  [${veniceOk ? "PASS" : "FAIL"}] Real Venice text received (${fullText.length} chars)`);
  console.log(`  [${drawsOk ? "PASS" : "FAIL"}] ≥3 gasless 1Shot draws settled on mainnet (got ${draws.length})`);
  console.log(`  [${gaslessOk ? "PASS" : "FAIL"}] Owner paid ZERO ETH for draws (gas in USDC via relayer)`);
  console.log(`  [${providerOk ? "PASS" : "FAIL"}] Provider received the drawn USDC (got ${usd(providerDelta)})`);
  console.log("=".repeat(72));

  const allPass = veniceOk && drawsOk && gaslessOk && providerOk;
  if (allPass) {
    console.log("MAINNET E2E: PASS ✔  (real Venice inference + gasless 1Shot draws on Base mainnet)");
  } else {
    console.log("MAINNET E2E: FAIL ✗");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nMAINNET E2E FAILED:");
  console.error(e);
  process.exit(1);
});
