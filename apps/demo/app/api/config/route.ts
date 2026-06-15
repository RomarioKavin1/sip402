export const runtime = "nodejs";

// ── /api/config — network configuration for the client ───────────────────────
// Returns whether this deployment is wired to mainnet (Base) or testnet (Base
// Sepolia), plus the matching Basescan tx-explorer base URL. The page fetches
// this once on mount so receipt/ticker links and copy resolve to the right
// network without baking the choice into the client bundle.

import { NextResponse } from "next/server";
import { IS_MAINNET } from "@sip402/core";

export async function GET() {
  return NextResponse.json({
    isMainnet: IS_MAINNET,
    network: IS_MAINNET ? "base" : "base-sepolia",
    basescanBase: IS_MAINNET
      ? "https://basescan.org/tx"
      : "https://sepolia.basescan.org/tx",
  });
}
