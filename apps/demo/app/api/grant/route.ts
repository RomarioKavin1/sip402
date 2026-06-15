export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { state } from "../../../lib/state";
import { pushEvent } from "../../../lib/bus";

/**
 * /api/grant — receive the MetaMask ERC-7715 granted permission and store it as
 * the session's ROOT permission context.
 *
 * The client calls `walletClient.requestExecutionPermissions([...])` with
 * `to = state.sessionAddress` (the server-generated session delegate). MetaMask
 * returns a `PermissionResponse` whose key fields are:
 *
 *   - context: Hex             — the signed delegation chain (root → session). This
 *                                is the `parentPermissionContext` we redelegate from.
 *   - from?: Hex               — the granting smart account (root delegator).
 *   - delegationManager: Hex   — the manager the chain must be redeemed through.
 *
 * We persist these so /api/run can redeem the granted context directly — the
 * session account is the grant's delegate, so it batch-redeems commitments on-chain
 * (one redeemDelegations tx per batch), spending the granted budget as real Base
 * Sepolia USDC transfers.
 */
export async function POST(req: Request) {
  let body: {
    context?: string;
    from?: string;
    delegationManager?: string;
    dependencies?: { factory?: string; factoryData?: string }[];
    permission?: unknown;
    chainId?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!state.sessionAddress || !state.sessionPrivateKey) {
    return NextResponse.json(
      { error: "no open session — call /api/open first" },
      { status: 400 },
    );
  }

  const context = body.context;
  if (typeof context !== "string" || !context.startsWith("0x")) {
    return NextResponse.json(
      { error: "missing or malformed `context` (expected the granted permission context Hex)" },
      { status: 400 },
    );
  }

  state.grantContext = context as `0x${string}`;
  state.grantFrom = typeof body.from === "string" ? body.from : null;
  state.grantDelegationManager =
    typeof body.delegationManager === "string" ? body.delegationManager : null;
  state.grantDependencies = Array.isArray(body.dependencies)
    ? body.dependencies
        .filter((d) => typeof d?.factory === "string" && typeof d?.factoryData === "string")
        .map((d) => ({ factory: d.factory as string, factoryData: d.factoryData as string }))
    : [];
  state.grantDrawn = 0n;

  // Log shapes for the human running the live test (helps confirm the grant).
  // eslint-disable-next-line no-console
  console.log("[/api/grant] stored MetaMask ERC-7715 grant:", {
    sessionAddress: state.sessionAddress,
    contextBytes: (context.length - 2) / 2,
    from: state.grantFrom,
    delegationManager: state.grantDelegationManager,
    dependencies: state.grantDependencies.length,
  });

  pushEvent({
    type: "status",
    payload: {
      msg: "Permission granted via MetaMask — periodic spending cap stored on-chain",
      sessionAddress: state.sessionAddress,
      from: state.grantFrom,
    },
  });

  return NextResponse.json({
    ok: true,
    sessionAddress: state.sessionAddress,
    stored: {
      contextBytes: (context.length - 2) / 2,
      from: state.grantFrom,
      delegationManager: state.grantDelegationManager,
    },
  });
}
