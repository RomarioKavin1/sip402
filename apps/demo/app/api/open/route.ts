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

export async function POST(req: Request) {
  try {
    // Optional { mode: "venice" | "batch" } — selects the mainnet rail. Ignored on testnet.
    const body = (await req.json().catch(() => ({}))) as { mode?: "venice" | "batch" };
    const mode = body.mode === "batch" ? "batch" : "venice";

    resetState();

    if (IS_MAINNET && mode === "batch") {
      // ── Mainnet BATCH rail: same MetaMask ERC-7715 grant flow as testnet, but
      // settled gaslessly through the 1Shot relayer. Generate the SESSION keypair
      // (the grant's delegate); the client drives a MAINNET grant to it, then
      // /api/run redelegates → 1Shot target and batch-redeems with cap-revert.
      state.mainnetMode = "batch";
      const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
      const sessionKey = generatePrivateKey();
      const sessionAccount = privateKeyToAccount(sessionKey);
      state.sessionPrivateKey = sessionKey;
      state.sessionAddress = sessionAccount.address;

      pushEvent({
        type: "status",
        payload: {
          msg: "Mainnet batch session — awaiting MetaMask permission grant",
          network: "base",
          sessionAddress: sessionAccount.address,
        },
      });

      return NextResponse.json({
        network: "base",
        mode: "batch",
        sessionAddress: sessionAccount.address,
        // Keep treasury/agent/capUsd present so the existing UI types still validate.
        treasury: sessionAccount.address,
        agent: sessionAccount.address,
        capUsd: 0.15,
        sellerAddress: sessionAccount.address,
      });
    }

    if (IS_MAINNET) {
      // ── Mainnet VENICE rail: no treasury deploy needed. The funded EOA is the
      // "agent". The run route drives veniceUpstream + createOneShotSettler directly.
      state.mainnetMode = "venice";
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
        mode: "venice",
        agent: agentAddress,
        budgetUsd,
        // Provide empty treasury/sellerAddress so the UI's DemoData type still validates
        treasury: agentAddress,
        capUsd: budgetUsd,
        sellerAddress: agentAddress,
      });
    }

    // ── Testnet: MetaMask ERC-7715 grant flow ───────────────────────────────
    // We generate a fresh SESSION keypair (the delegate the agent will use to
    // sign the open redelegation that the seller redeems). The session PRIVATE
    // KEY stays in server state only — the client never sees it. The client
    // drives MetaMask to grant an erc20-token-periodic permission `to` this
    // session address, then POSTs the granted context to /api/grant.
    //
    // We also pre-generate + gas-fund the SELLER EOA (the redeemer that pays gas
    // when redeeming the granted budget via redeemDelegations).
    const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
    const { createPublicClient, createWalletClient, http, parseEther } = await import("viem");
    const { baseSepolia } = await import("viem/chains");

    const ownerKey = ownerPrivateKey() as `0x${string}`;

    // Session keypair = the grant DELEGATE (signs the open redelegation).
    const sessionKey = generatePrivateKey();
    const sessionAccount = privateKeyToAccount(sessionKey);
    state.sessionPrivateKey = sessionKey;
    state.sessionAddress = sessionAccount.address;

    // Seller keypair = the on-chain REDEEMER (pays gas, receives USDC).
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
    // Fund the SESSION EOA — it is the grant's delegate and redeems the granted
    // permission on-chain directly (pays gas). Funded at open time so it is
    // confirmed before "Run" (avoids an RPC-lag race mid-run). Also fund the
    // SELLER EOA a little: it pays gas for a one-time counterfactual-account
    // deploy if the granting MetaMask account isn't deployed yet. Amounts kept
    // small so a lightly-funded owner key can run the demo.
    const sessionEth = await publicClient.getBalance({ address: sessionAccount.address });
    if (sessionEth < parseEther("0.0035")) {
      const fundHash = await walletClient.sendTransaction({
        to: sessionAccount.address,
        value: parseEther("0.005"),
        account: ownerAccount,
        chain: baseSepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: fundHash });
    }
    const sellerEth = await publicClient.getBalance({ address: seller.address });
    if (sellerEth < parseEther("0.002")) {
      const sellerFundHash = await walletClient.sendTransaction({
        to: seller.address,
        value: parseEther("0.003"),
        account: ownerAccount,
        chain: baseSepolia,
      });
      await publicClient.waitForTransactionReceipt({ hash: sellerFundHash });
    }

    pushEvent({
      type: "status",
      payload: {
        msg: "Session keypair generated — awaiting MetaMask permission grant",
        network: "base-sepolia",
        sessionAddress: sessionAccount.address,
        sellerAddress: seller.address,
      },
    });

    // capUsd here is the per-agent display cap; the real on-chain cap is the
    // 0.30-USDC/day periodic permission the user grants in MetaMask.
    return NextResponse.json({
      network: "base-sepolia",
      sessionAddress: sessionAccount.address,
      sellerAddress: seller.address,
      // Keep treasury/agent/capUsd present so the existing UI types still validate.
      treasury: sessionAccount.address,
      agent: sessionAccount.address,
      capUsd: 1,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
