export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, http, parseEther, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { openSession } from "@sip402/client";
import { DEFAULT_RPC_URL } from "@sip402/core";
import { state, resetState } from "../../../lib/state";
import { pushEvent } from "../../../lib/bus";

function ownerPrivateKey(): Hex {
  const k = process.env.PRIVATE_KEY;
  if (!k) throw new Error("PRIVATE_KEY not set");
  return k as Hex;
}

export async function POST() {
  try {
    // Reset any prior run so UI starts fresh.
    resetState();

    const ownerKey = ownerPrivateKey();

    // 1. Open root session: treasury → orchestrator, cap $1 / 24h.
    const session = await openSession({
      ownerPrivateKey: ownerKey,
      capUsd: 1,
      periodSeconds: 86400,
    });
    state.session = session;

    // 2. Lazily generate + fund the seller EOA (needs ETH for redemption gas).
    const sellerKey = generatePrivateKey();
    const seller = privateKeyToAccount(sellerKey);
    state.sellerPrivateKey = sellerKey;
    state.sellerAddress = seller.address;

    // Fund seller with ~0.02 ETH from owner so it can pay gas.
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(DEFAULT_RPC_URL),
    });
    const ownerAccount = privateKeyToAccount(ownerKey);
    const walletClient = createWalletClient({
      chain: baseSepolia,
      transport: http(DEFAULT_RPC_URL),
      account: ownerAccount,
    });
    const sellerEth = await publicClient.getBalance({ address: seller.address });
    if (sellerEth < parseEther("0.01")) {
      const fundHash = await walletClient.sendTransaction({
        to: seller.address,
        value: parseEther("0.02"),
        account: ownerAccount,
        chain: baseSepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: fundHash });
    }

    pushEvent({
      type: "status",
      payload: {
        msg: "Session opened",
        treasury: session.treasuryAddress,
        agent: session.agentAddress,
        capUsd: 1,
        sellerAddress: seller.address,
      },
    });

    return NextResponse.json({
      treasury: session.treasuryAddress,
      agent: session.agentAddress,
      capUsd: 1,
      sellerAddress: seller.address,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
