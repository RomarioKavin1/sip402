export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { IS_MAINNET, toUsdcAtoms, createOneShotSettler, createDirectRedeemSettler, USDC } from "@sip402/core";
import { veniceUpstream, localUpstream, tokenCostAtoms, StreamingDrawer, DryTabError } from "@sip402/splitter";
import type { SettlementEvent } from "@sip402/server";
import { state } from "../../../lib/state";
import { pushEvent } from "../../../lib/bus";

export async function POST() {
  if (state.running) {
    return NextResponse.json({ error: "Already running" }, { status: 409 });
  }
  state.running = true;

  try {
    if (IS_MAINNET) {
      return await runMainnet();
    } else if (state.grantContext) {
      // Testnet with a real MetaMask ERC-7715 grant: spend the granted budget.
      return await runTestnetGrant();
    } else {
      // Testnet legacy path (no wallet): programmatic openSession.
      return await runTestnet();
    }
  } finally {
    state.running = false;
  }
}

// ── MAINNET: real Venice inference + gasless 1Shot draws ──────────────────────

async function runMainnet(): Promise<Response> {
  if (!state.mainnetAgent) {
    return NextResponse.json({ error: "Call /api/open first" }, { status: 400 });
  }

  const ownerKey = process.env.PRIVATE_KEY;
  if (!ownerKey) {
    return NextResponse.json({ error: "PRIVATE_KEY not set" }, { status: 500 });
  }

  const { privateKeyToAccount } = await import("viem/accounts");
  const ownerAccount = privateKeyToAccount(ownerKey as `0x${string}`);

  // Fixed demo provider address — receives the metered payments.
  // Using a fresh ephemeral address is fine; the mainnet-e2e does the same.
  const { generatePrivateKey } = await import("viem/accounts");
  const providerAddress = privateKeyToAccount(generatePrivateKey()).address;

  // Venice settings (mirror mainnet-e2e.ts)
  const VENICE_MODEL = "llama-3.3-70b";
  const RESALE_ATOMS_PER_TOKEN = 800n; // $0.0008/token → retail billing
  const DRAW_THRESHOLD_ATOMS = 20_000n; // $0.02 → one 1Shot draw
  const MAX_DRAWS = 6; // cap ~$0.12 total

  const settler = createOneShotSettler({ ownerAccount });

  const upstream = veniceUpstream(ownerKey);
  const prompt =
    "In three short sentences, explain what a per-token stablecoin micropayment protocol does and why it matters for AI agents.";

  let accrued = 0n;
  let drawnTotal = 0n;
  let drawCount = 0;
  let capped = false;

  pushEvent({ type: "tree_update", payload: { open: true, mainnet: true } });
  pushEvent({
    type: "status",
    payload: { msg: "Mainnet run: streaming Venice inference..." },
  });

  try {
    for await (const chunk of upstream.chatStream({
      model: VENICE_MODEL,
      messages: [{ role: "user", content: prompt }],
    })) {
      // Stream text to UI
      pushEvent({ type: "agent_text", agent: "researcher", payload: { text: chunk.text } });
      state.writerText += chunk.text; // reuse writerText slot for the researcher

      if (!capped) {
        accrued += BigInt(chunk.tokens) * RESALE_ATOMS_PER_TOKEN;

        // Drain accrued in threshold-sized batches (Venice may deliver large chunks)
        while (!capped && accrued >= DRAW_THRESHOLD_ATOMS) {
          accrued -= DRAW_THRESHOLD_ATOMS;
          const atoms = DRAW_THRESHOLD_ATOMS;

          try {
            pushEvent({
              type: "status",
              payload: { msg: `Draw #${drawCount + 1}: settling $${(Number(atoms) / 1e6).toFixed(4)} via 1Shot...` },
            });

            const result = await settler.settle({ payTo: providerAddress, atoms });
            drawnTotal += atoms;
            drawCount++;
            state.totalDrawn += atoms;
            state.writerDrawn += atoms;

            pushEvent({
              type: "settlement",
              agent: "researcher",
              payload: {
                amountAtoms: atoms.toString(),
                txHash: result.txHash,
                commitmentIds: [],
                at: Date.now(),
              },
            });

            pushEvent({
              type: "status",
              payload: { msg: `Draw #${drawCount} confirmed: ${result.txHash}` },
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pushEvent({
              type: "status",
              payload: { msg: `Draw failed: ${msg}` },
            });
            capped = true;
          }

          if (drawCount >= MAX_DRAWS) {
            capped = true;
            pushEvent({
              type: "status",
              payload: { msg: `Cap reached (${MAX_DRAWS} draws, ~$${(Number(drawnTotal) / 1e6).toFixed(4)} USDC)` },
            });
          }
        }
      }
    }

    // Flush final partial batch if headroom remains
    if (!capped && accrued > 0n && drawCount < MAX_DRAWS) {
      const atoms = accrued;
      accrued = 0n;
      try {
        const result = await settler.settle({ payTo: providerAddress, atoms });
        drawnTotal += atoms;
        drawCount++;
        state.totalDrawn += atoms;
        state.writerDrawn += atoms;

        pushEvent({
          type: "settlement",
          agent: "researcher",
          payload: {
            amountAtoms: atoms.toString(),
            txHash: result.txHash,
            commitmentIds: [],
            at: Date.now(),
          },
        });
      } catch {
        // ignore final flush failure
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    pushEvent({ type: "status", payload: { msg: `Mainnet run error: ${msg}` } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  pushEvent({
    type: "status",
    payload: {
      msg: `Mainnet run complete — ${drawCount} draws, $${(Number(drawnTotal) / 1e6).toFixed(6)} USDC spent`,
    },
  });
  // Signal "done" to the UI using the same "Cascade complete" sentinel
  pushEvent({ type: "status", payload: { msg: "Cascade complete" } });

  return NextResponse.json({ ok: true, draws: drawCount, drawnAtoms: drawnTotal.toString() });
}

// ── TESTNET: two-agent redelegation + DirectRedeem + localUpstream ────────────

async function runTestnet(): Promise<Response> {
  if (!state.session || !state.sellerPrivateKey || !state.sellerAddress) {
    return NextResponse.json({ error: "Call /api/open first" }, { status: 400 });
  }

  const { redelegateSession, createCommitment } = await import("@sip402/client");
  type Commitment = Awaited<ReturnType<typeof createCommitment>>;

  const parentSession = state.session;
  const sellerPrivateKey = state.sellerPrivateKey as `0x${string}`;
  const sellerAddress = state.sellerAddress as `0x${string}`;

  // Tuned for visibility: $0.02 per draw → 4–6 visible draws before cap,
  // and the last over-cap draw reverts on-chain (dry-tab demo).
  // localUpstream yields ~300 words ≈ 75 tokens per pass.
  // tokenCostAtoms(75) = ceil(75 * 2000 / 1000) = 150 atoms per pass.
  // With minBatchAtoms = 20_000 atoms ($0.02), need 20_000/150 ≈ 134 passes per draw.
  // 20 repeats × 134 passes would be too slow; so we raise the per-token cost.
  // We use a higher ATOMS_PER_TOKEN_OVERRIDE to make each localUpstream pass cost more.
  // Actually, localUpstream uses tokenCostAtoms from pricing.ts (2000 per 1k tokens).
  // Better: set minBatchAtoms low so draws fire quickly within 20 repeats.
  // With 20 repeats × 75 tokens × 2 atoms/token = 3000 atoms total for writer.
  // So set minBatchAtoms = 500 atoms → ~6 draws per agent (3000/500 = 6).
  const minBatchAtoms = 500n; // ~$0.0005 per draw — triggers 6+ real txs per agent

  try {
    const [writerSession, illustratorSession] = await Promise.all([
      redelegateSession({ parentSession, childCapUsd: 0.4, periodSeconds: 86400 }),
      redelegateSession({ parentSession, childCapUsd: 0.4, periodSeconds: 86400 }),
    ]);
    state.writerSession = writerSession;
    state.illustratorSession = illustratorSession;

    pushEvent({ type: "tree_update", payload: { open: true } });

    const [writerCommitment, illustratorCommitment] = await Promise.all([
      createCommitment({ session: writerSession, sellerAddress, amountAtoms: toUsdcAtoms(0.4) }),
      createCommitment({ session: illustratorSession, sellerAddress, amountAtoms: toUsdcAtoms(0.4) }),
    ]);

    async function runAgent(
      agent: "writer" | "illustrator",
      sellerPk: `0x${string}`,
      commitment: Commitment,
    ) {
      const onEvent = (e: SettlementEvent) => {
        if (agent === "writer") {
          state.writerDrawn += e.amountAtoms;
        } else {
          state.illustratorDrawn += e.amountAtoms;
        }
        state.totalDrawn += e.amountAtoms;
        pushEvent({
          type: "settlement",
          agent,
          payload: {
            amountAtoms: e.amountAtoms.toString(),
            txHash: e.txHash,
            commitmentIds: e.commitmentIds,
            at: e.at,
          },
        });
      };

      const drawer = new StreamingDrawer({
        sellerPrivateKey: sellerPk,
        commitment,
        minBatchAtoms,
        onEvent,
      });

      const up = localUpstream();
      // 20 repeats × ~75 tokens × 2 atoms/token ≈ 3000 atoms total
      // With minBatchAtoms = 500, yields ~6 draws before finalize.
      const REPEATS = 20;
      try {
        for (let r = 0; r < REPEATS; r++) {
          for await (const chunk of up.chatStream({ model: "local", messages: [] })) {
            pushEvent({ type: "agent_text", agent, payload: { text: chunk.text } });
            if (agent === "writer") {
              state.writerText += chunk.text;
            } else {
              state.illustratorText += chunk.text;
            }
            await drawer.record(tokenCostAtoms(chunk.tokens));
          }
        }
        await drawer.finalize();
      } catch (err) {
        if (err instanceof DryTabError) {
          pushEvent({
            type: "status",
            agent,
            payload: { msg: `${agent} tab dry — halted`, txHash: (err as DryTabError).txHash },
          });
        } else {
          throw err;
        }
      }
    }

    await Promise.allSettled([
      runAgent("writer", sellerPrivateKey, writerCommitment),
      runAgent("illustrator", sellerPrivateKey, illustratorCommitment),
    ]);

    pushEvent({ type: "status", payload: { msg: "Cascade complete" } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── TESTNET (MetaMask grant): spend the granted ERC-7715 budget ───────────────
//
// The buyer granted a real erc20-token-periodic permission in MetaMask
// (2 USDC/day) `to` the server-generated SESSION account. For each metered
// batch we:
//   1. Build an OPEN REDELEGATION session → seller from the granted context using
//      the kit's createx402DelegationProvider (signed by the session account).
//      It returns a fully-encoded `permissionContext` (the open redelegation
//      prepended onto the granted chain) plus the delegationManager + delegator.
//   2. Have the SELLER (a gas-funded EOA) redeem that permissionContext via the
//      proven createDirectRedeemSettler → redeemDelegations flow, executing a
//      USDC transfer of `atoms` to the seller. The transfer draws against the
//      MetaMask-granted budget — a real Base Sepolia tx.
//
// When cumulative draws exceed the granted 2-USDC/day cap, the on-chain
// ERC20PeriodTransferEnforcer reverts the redemption → dry-tab demo. We surface
// that revert as a halt for the "writer" agent panel (same UX as the legacy path).
async function runTestnetGrant(): Promise<Response> {
  if (!state.grantContext || !state.sessionPrivateKey || !state.sellerPrivateKey || !state.sellerAddress) {
    return NextResponse.json(
      { error: "no MetaMask grant — open the tab and approve the permission first" },
      { status: 400 },
    );
  }

  const { privateKeyToAccount } = await import("viem/accounts");

  const sessionAccount = privateKeyToAccount(state.sessionPrivateKey as `0x${string}`);
  const sellerAccount = privateKeyToAccount(state.sellerPrivateKey as `0x${string}`);
  const sellerAddress = state.sellerAddress as `0x${string}`;
  const parentContext = state.grantContext as `0x${string}`;
  const from = (state.grantFrom ?? undefined) as `0x${string}` | undefined;

  // The session account IS the delegate of the MetaMask-granted permission, so it
  // redeems the granted context directly (single hop, proven rail-proof pattern).
  // It pays gas, so fund it a little ETH from the owner first.
  const settler = createDirectRedeemSettler({ delegateAccount: sessionAccount });
  {
    const { createPublicClient, createWalletClient, http, parseEther } = await import("viem");
    const { baseSepolia } = await import("viem/chains");
    const { DEFAULT_RPC_URL } = await import("@sip402/core");
    const pub = createPublicClient({ chain: baseSepolia, transport: http(DEFAULT_RPC_URL) });
    const bal = await pub.getBalance({ address: sessionAccount.address });
    if (bal < parseEther("0.001")) {
      const owner = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
      const ownerWallet = createWalletClient({ account: owner, chain: baseSepolia, transport: http(DEFAULT_RPC_URL) });
      const h = await ownerWallet.sendTransaction({ to: sessionAccount.address, value: parseEther("0.004") });
      await pub.waitForTransactionReceipt({ hash: h });
      pushEvent({ type: "status", payload: { msg: `Funded session ${sessionAccount.address} for gas` } });
    }
  }

  // If the granting smart account is counterfactual (not yet deployed), the
  // granted chain's `dependencies` deploy it. Land them once, from the seller,
  // before the first redeem — otherwise the first redemption reverts ("no code").
  if (state.grantDependencies.length > 0 && from) {
    const { createPublicClient, createWalletClient, http } = await import("viem");
    const { baseSepolia } = await import("viem/chains");
    const { DEFAULT_RPC_URL } = await import("@sip402/core");
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http(DEFAULT_RPC_URL) });
    const code = await publicClient.getCode({ address: from });
    if (!code || code === "0x") {
      const sellerWallet = createWalletClient({
        account: sellerAccount,
        chain: baseSepolia,
        transport: http(DEFAULT_RPC_URL),
      });
      pushEvent({
        type: "status",
        payload: { msg: `Deploying granting smart account ${from} (counterfactual) before first redeem...` },
      });
      for (const dep of state.grantDependencies) {
        try {
          const hash = await sellerWallet.sendTransaction({
            to: dep.factory as `0x${string}`,
            data: dep.factoryData as `0x${string}`,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          pushEvent({ type: "status", payload: { msg: `Dependency deployed: ${hash}` } });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          pushEvent({ type: "status", payload: { msg: `Dependency deploy failed (continuing): ${msg}` } });
        }
      }
    }
  }

  // Each metered request is a $0.04 COMMITMENT. The seller (here the session,
  // which is the grant's delegate) ACCUMULATES commitments and redeems them in
  // BATCHES — many commitments per redeemDelegations tx (the batch-settlement
  // scheme). When a batch would push cumulative draws past the granted
  // 0.30 USDC/day cap, the on-chain ERC20PeriodTransferEnforcer reverts the
  // WHOLE batch atomically (the dry tab).
  const COMMIT_ATOMS = 40_000n; // $0.04 per commitment
  const BATCH_SIZE = 3; // commitments accumulated per on-chain batch
  const MAX_BATCHES = 4; // safety stop (the cap is also enforced on-chain)

  pushEvent({ type: "tree_update", payload: { open: true } });
  pushEvent({
    type: "status",
    payload: {
      msg: `Accumulating commitments (session ${state.sessionAddress}) → batch-redeem to seller ${sellerAddress}`,
    },
  });

  const up = localUpstream();
  const pending: bigint[] = [];
  let accrued = 0n;
  let batchCount = 0;
  let capped = false;

  // Redeem ALL accumulated commitments in ONE redeemDelegations tx.
  async function flushBatch(): Promise<boolean> {
    if (pending.length === 0) return true;
    const atomsList = pending.splice(0, pending.length);
    const total = atomsList.reduce((a, b) => a + b, 0n);
    try {
      pushEvent({
        type: "status",
        agent: "writer",
        payload: {
          msg: `Batch #${batchCount + 1}: redeeming ${atomsList.length} commitments ($${(Number(total) / 1e6).toFixed(2)}) in ONE tx...`,
        },
      });

      if (!settler.settleBatch) throw new Error("settler does not support batch settlement");
      const result = await settler.settleBatch({
        signedDelegation: parentContext,
        payTo: sellerAddress,
        atomsList,
      });

      batchCount++;
      state.grantDrawn += total;
      state.writerDrawn += total;
      state.totalDrawn += total;

      pushEvent({
        type: "settlement",
        agent: "writer",
        payload: {
          amountAtoms: total.toString(),
          txHash: result.txHash,
          count: result.count,
          at: Date.now(),
        },
      });
      pushEvent({
        type: "status",
        agent: "writer",
        payload: { msg: `Batch #${batchCount} confirmed: ${result.count} commitments → ${result.txHash}` },
      });
      return true;
    } catch (err) {
      // The batch pushed cumulative draws past the on-chain cap → atomic revert.
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[flushBatch] batch redemption reverted:", err);
      pushEvent({
        type: "settlement",
        agent: "writer",
        payload: {
          amountAtoms: "0",
          attemptedAtoms: total.toString(),
          count: atomsList.length,
          reverted: true,
          at: Date.now(),
        },
      });
      pushEvent({
        type: "status",
        agent: "writer",
        payload: { msg: `Batch #${batchCount + 1} reverted — cap reached on-chain (dry tab): ${msg}` },
      });
      return false;
    }
  }

  try {
    const REPEATS = 40; // enough localUpstream text to accrue several batches
    outer: for (let r = 0; r < REPEATS && !capped; r++) {
      for await (const chunk of up.chatStream({ model: "local", messages: [] })) {
        pushEvent({ type: "agent_text", agent: "writer", payload: { text: chunk.text } });
        state.writerText += chunk.text;
        accrued += BigInt(chunk.tokens) * 55n;

        // Mint $0.04 commitments as delivery accrues; batch every BATCH_SIZE.
        while (accrued >= COMMIT_ATOMS) {
          accrued -= COMMIT_ATOMS;
          pending.push(COMMIT_ATOMS);
          if (pending.length >= BATCH_SIZE) {
            const ok = await flushBatch();
            if (!ok) { capped = true; break outer; }
            if (batchCount >= MAX_BATCHES) { capped = true; break outer; }
          }
        }
      }
    }

    // Flush any trailing commitments as a final (smaller) batch.
    if (!capped) {
      const ok = await flushBatch();
      if (!ok) capped = true;
    }
  } catch (err) {
    if (err instanceof DryTabError) {
      pushEvent({
        type: "status",
        agent: "writer",
        payload: { msg: "writer tab dry — halted", txHash: (err as DryTabError).txHash },
      });
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      pushEvent({ type: "status", payload: { msg: `Grant run error: ${msg}` } });
      pushEvent({ type: "status", payload: { msg: "Cascade complete" } });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  pushEvent({
    type: "status",
    payload: {
      msg: `Batch run complete — ${batchCount} batches, $${(Number(state.grantDrawn) / 1e6).toFixed(6)} USDC settled`,
    },
  });
  pushEvent({ type: "status", payload: { msg: "Cascade complete" } });

  return NextResponse.json({ ok: true, batches: batchCount, drawnAtoms: state.grantDrawn.toString() });
}
