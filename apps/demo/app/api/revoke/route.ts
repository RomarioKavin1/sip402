export const runtime = "nodejs";

// ── /api/revoke — stop an agent from drawing further ──────────────────────────
// Two paths, depending on how the session was opened:
//   • Grant path: there is no programmatic Session to revoke on-chain here — the
//     budget lives in the buyer's MetaMask permission. We stop the agent by
//     dropping the stored grant context server-side (no further draws can be
//     redeemed). Full on-chain revocation is the buyer's to do in MetaMask.
//   • Legacy path: revoke the per-agent programmatic Session on-chain via
//     revokeSession (signed by the owner key), returning the revoke tx hash.

import { NextResponse } from "next/server";
import { revokeSession } from "@sip402/client";
import type { Hex } from "viem";
import { state } from "../../../lib/state";
import { pushEvent } from "../../../lib/bus";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { agent?: string };
  const agent = body.agent;

  if (agent !== "writer" && agent !== "illustrator") {
    return NextResponse.json({ error: "agent must be 'writer' or 'illustrator'" }, { status: 400 });
  }

  // ── MetaMask grant flow ───────────────────────────────────────────────────
  // The testnet grant path has no per-agent programmatic Session; the budget is
  // the MetaMask-granted permission. "Revoke" here STOPS the agent by dropping
  // the stored grant context so no further draws can be redeemed. (To revoke the
  // permission fully on-chain, the buyer revokes it from the MetaMask UI.)
  if (state.grantContext) {
    state.grantContext = null;
    if (agent === "writer") state.writerRevoked = true;
    else state.illustratorRevoked = true;
    pushEvent({
      type: "status",
      agent,
      payload: { msg: `${agent} session revoked — granted budget disabled (no further draws)` },
    });
    return NextResponse.json({ ok: true });
  }

  const ownerKey = process.env.PRIVATE_KEY as Hex | undefined;
  if (!ownerKey) return NextResponse.json({ error: "PRIVATE_KEY not set" }, { status: 500 });

  const session = agent === "writer" ? state.writerSession : state.illustratorSession;
  if (!session) {
    return NextResponse.json({ error: `${agent} session not found — run /api/run first` }, { status: 400 });
  }

  try {
    const { txHash } = await revokeSession({ session, ownerPrivateKey: ownerKey });

    if (agent === "writer") state.writerRevoked = true;
    else state.illustratorRevoked = true;

    pushEvent({
      type: "status",
      agent,
      payload: { msg: `${agent} session revoked`, txHash },
    });

    return NextResponse.json({ ok: true, txHash });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
