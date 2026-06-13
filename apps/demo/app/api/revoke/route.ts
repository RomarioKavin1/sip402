export const runtime = "nodejs";

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
