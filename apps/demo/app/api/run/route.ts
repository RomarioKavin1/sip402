export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { redelegateSession, createCommitment } from "@sip402/client";
import type { Commitment } from "@sip402/client";
import { toUsdcAtoms } from "@sip402/core";
import { StreamingDrawer, DryTabError, localUpstream, tokenCostAtoms } from "@sip402/splitter";
import type { SettlementEvent } from "@sip402/server";
import type { Hex } from "viem";
import { state } from "../../../lib/state";
import { pushEvent } from "../../../lib/bus";

export async function POST() {
  if (!state.session || !state.sellerPrivateKey || !state.sellerAddress) {
    return NextResponse.json({ error: "Call /api/open first" }, { status: 400 });
  }
  if (state.running) {
    return NextResponse.json({ error: "Already running" }, { status: 409 });
  }
  state.running = true;

  const parentSession = state.session;
  const sellerPrivateKey = state.sellerPrivateKey as Hex;
  const sellerAddress = state.sellerAddress as `0x${string}`;
  // Set minBatch to 1000 atoms ($0.001) so localUpstream's small token chunks
  // trigger real on-chain draws without needing millions of tokens.
  // The spec says $0.10 draws; for testnet demo with localUpstream we use a
  // smaller batch so multiple settlement txs fire within the capped response.
  const minBatchAtoms = 1000n; // ~$0.001 per draw — triggers multiple real txs per agent

  try {
    // Create sub-sessions for both agents concurrently (off-chain signing, fast).
    const [writerSession, illustratorSession] = await Promise.all([
      redelegateSession({ parentSession, childCapUsd: 0.4, periodSeconds: 86400 }),
      redelegateSession({ parentSession, childCapUsd: 0.4, periodSeconds: 86400 }),
    ]);
    state.writerSession = writerSession;
    state.illustratorSession = illustratorSession;

    pushEvent({ type: "tree_update", payload: { open: true } });

    // Create commitments for both agents.
    const [writerCommitment, illustratorCommitment] = await Promise.all([
      createCommitment({ session: writerSession, sellerAddress, amountAtoms: toUsdcAtoms(0.4) }),
      createCommitment({ session: illustratorSession, sellerAddress, amountAtoms: toUsdcAtoms(0.4) }),
    ]);

    // Run both agents concurrently.
    async function runAgent(
      agent: "writer" | "illustrator",
      sellerPk: Hex,
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
      // localUpstream uses a canned response of ~500 tokens per pass.
      // With USDC_PER_1K_TOKENS=2000 that's ~1000 atoms/pass (~$0.001).
      // Repeat enough times to exhaust a $0.40 cap at $0.001/pass = ~400 passes
      // but cap at 20 to keep spend reasonable while still showing many draws.
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
        // Flush any remainder.
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

    // Run concurrently; wait for both.
    await Promise.allSettled([
      runAgent("writer", sellerPrivateKey, writerCommitment),
      runAgent("illustrator", sellerPrivateKey, illustratorCommitment),
    ]);

    pushEvent({ type: "status", payload: { msg: "Cascade complete" } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    state.running = false;
  }
}
