export const runtime = "nodejs";

// ── /api/revoke — stop the agent from drawing further ─────────────────────────
// The testnet demo runs on a MetaMask ERC-7715 grant: the budget lives in the
// buyer's on-chain permission, and the server holds only the grant *context*.
// "Revoke" here STOPS the agent by dropping that stored context and flagging the
// run revoked — the batch loop in /api/run re-reads this each chunk and halts, so
// no further draws are redeemed. (To revoke the permission fully on-chain, the
// buyer revokes it from the MetaMask UI; the granted budget is theirs to pull.)

import { NextResponse } from "next/server";
import { state } from "../../../lib/state";
import { pushEvent } from "../../../lib/bus";

export async function POST() {
  if (!state.grantContext) {
    return NextResponse.json(
      { error: "no active grant to revoke — open a tab and run first" },
      { status: 400 },
    );
  }

  state.grantContext = null;
  state.writerRevoked = true;

  pushEvent({
    type: "status",
    agent: "writer",
    payload: { msg: "Agent revoked — granted budget disabled (no further draws)" },
  });

  return NextResponse.json({ ok: true });
}
