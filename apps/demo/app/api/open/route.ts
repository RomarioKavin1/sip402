export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { IS_MAINNET, DEFAULT_RPC_URL } from "@sip402/core";
import { state, resetState } from "../../../lib/state";
import { pushEvent } from "../../../lib/bus";

function ownerPrivateKey(): string {
  const k = process.env.PRIVATE_KEY;
  if (!k) throw new Error("PRIVATE_KEY not set");
  return k;
}

export async function POST() {
  try {
    resetState();

    if (IS_MAINNET) {
      // ── Mainnet: no treasury deploy needed. The funded EOA is the "agent".
      // The run route will drive veniceUpstream + createOneShotSettler directly.
      const { privateKeyToAccount } = await import("viem/accounts");
      const ownerKey = ownerPrivateKey() as `0x${string}`;
      const ownerAccount = privateKeyToAccount(ownerKey);
      const agentAddress = ownerAccount.address;
      const budgetUsd = 0.15; // ~5–6 draws @ $0.02 each

      state.mainnetAgent = agentAddress;
      state.mainnetBudgetUsd = budgetUsd;

      pushEvent({
        type: "status",
        payload: {
          msg: "Mainnet session ready",
          network: "base",
          agent: agentAddress,
          budgetUsd,
        },
      });

      return NextResponse.json({
        network: "base",
        agent: agentAddress,
        budgetUsd,
        // Provide empty treasury/sellerAddress so the UI's DemoData type still validates
        treasury: agentAddress,
        capUsd: budgetUsd,
        sellerAddress: agentAddress,
      });
    }

    // ── Testnet: full openSession deploy + fund seller EOA ──────────────────
    const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
    const { createPublicClient, createWalletClient, http, parseEther } = await import("viem");
    const { baseSepolia } = await import("viem/chains");
    const { openSession } = await import("@sip402/client");

    const ownerKey = ownerPrivateKey() as `0x${string}`;

    const session = await openSession({
      ownerPrivateKey: ownerKey,
      capUsd: 1,
      periodSeconds: 86400,
    });
    state.session = session;

    const sellerKey = generatePrivateKey();
    const seller = privateKeyToAccount(sellerKey);
    state.sellerPrivateKey = sellerKey;
    state.sellerAddress = seller.address;

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
        network: "base-sepolia",
        treasury: session.treasuryAddress,
        agent: session.agentAddress,
        capUsd: 1,
        sellerAddress: seller.address,
      },
    });

    return NextResponse.json({
      network: "base-sepolia",
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
