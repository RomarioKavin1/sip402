export const runtime = "nodejs";

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
