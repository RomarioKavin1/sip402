/**
 * session.ts — openSession: the ROOT periodic delegation treasury → agent.
 *
 * The buyer's funds live in a MetaMask Hybrid smart account (the TREASURY).
 * openSession:
 *   1. deploys the treasury smart account (no bundler — plain factory tx),
 *   2. funds it with USDC (cap + buffer) so it has a balance to transfer,
 *   3. generates a fresh AGENT EOA (the buyer's session key),
 *   4. creates + signs an Erc20PeriodTransfer delegation treasury → agent
 *      capped at `capUsd` per `periodSeconds`.
 *
 * The agent is the DELEGATE of the root delegation. It is an EOA that only ever
 * SIGNS delegations off-chain (the commitment, agent → seller); it never sends a
 * transaction, so it needs no ETH. The SELLER redeems the chain and pays gas
 * (testnet) or relays via 1Shot (mainnet). See commitment.ts / redelegate.ts.
 *
 * Deploy + sign patterns are the proven no-bundler ones from
 * packages/core/scripts/rail-proof.ts.
 */

import {
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  toMetaMaskSmartAccount,
  Implementation,
  createDelegation,
  ScopeType,
  contracts,
  type Delegation,
} from "@metamask/smart-accounts-kit";

import { USDC, toUsdcAtoms, DEFAULT_RPC_URL } from "@sip402/core";
import { env, publicClientFor, walletClientFor, encodePermissionContext } from "./internal.js";

// ── Public type ───────────────────────────────────────────────────────────

export interface Session {
  /** The funded smart account that owns the USDC (root delegator). */
  treasuryAddress: Address;
  /** Private key of the agent EOA — the delegate that can redelegate/commit. */
  agentPrivateKey: Hex;
  /** Address of the agent EOA. */
  agentAddress: Address;
  /** The signed delegation chain to date, leaf-first (root session = [treasury→agent]). */
  rootSignedDelegation: unknown;
  /** ABI-encoded signed chain to date (the permissionContext base for commitments). */
  permissionContext: Hex;
  /** Session cap in USDC atoms (this hop's periodAmount). */
  capAtoms: bigint;
  /** Period length in seconds. */
  periodSeconds: number;
  /** Period start (unix seconds) — shared by all hops so periods align. */
  startDate: number;
  /**
   * The full signed delegation chain, leaf-first, as kit Delegation objects.
   * Root session = [treasury→agent]. A redelegated session prepends the new
   * leaf: [treasury→orchestrator→specialist] reversed for redemption.
   * Carried so redelegateSession / createCommitment can extend the chain.
   */
  chain: Delegation[];
}

// ── Constants ─────────────────────────────────────────────────────────────

// Fixed period start (2025-06-09T12:00:00Z) — deterministic, not now-derived,
// matching rail-proof.ts so the on-chain enforcer window is stable.
const START_DATE = 1749470400;

function transferCalldata(to: Address, atoms: bigint): Hex {
  return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, atoms] });
}

// ── openSession ───────────────────────────────────────────────────────────

export async function openSession(opts: {
  ownerPrivateKey: Hex;
  capUsd: number;
  periodSeconds: number;
  rpcUrl?: string;
}): Promise<Session> {
  const { ownerPrivateKey, capUsd, periodSeconds, rpcUrl = DEFAULT_RPC_URL } = opts;

  const publicClient = publicClientFor(rpcUrl);
  const owner = privateKeyToAccount(ownerPrivateKey);
  const ownerWallet = walletClientFor(owner, rpcUrl);
  const e = env();

  // 1. Treasury smart account — deploy if needed (plain factory tx, no bundler).
  const treasury = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [owner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: owner },
  });

  let deployed = await contracts.isContractDeployed({
    client: publicClient,
    contractAddress: treasury.address,
  });
  if (!deployed) {
    const { factory, factoryData } = await treasury.getFactoryArgs();
    const deployHash = await ownerWallet.sendTransaction({
      to: factory as Address,
      data: factoryData as Hex,
      chain: undefined,
      account: owner,
    });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    if (rcpt.status !== "success") throw new Error("Treasury deploy tx reverted");
    // Poll for code — RPC load balancers can briefly return stale state.
    for (let i = 0; i < 12 && !deployed; i++) {
      deployed = await contracts.isContractDeployed({
        client: publicClient,
        contractAddress: treasury.address,
      });
      if (!deployed) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!deployed) throw new Error("Treasury deploy failed: no code at address after polling");
  }

  // 2. Fund treasury with USDC (cap + 1 USDC buffer).
  const capAtoms = toUsdcAtoms(capUsd);
  const needed = capAtoms + toUsdcAtoms(1);
  const treasuryUsdc = (await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [treasury.address],
  })) as bigint;
  if (treasuryUsdc < needed) {
    const fundHash = await ownerWallet.sendTransaction({
      to: USDC,
      data: transferCalldata(treasury.address, needed - treasuryUsdc),
      chain: undefined,
      account: owner,
    });
    const fr = await publicClient.waitForTransactionReceipt({ hash: fundHash });
    if (fr.status !== "success") throw new Error("USDC fund tx reverted");
  }

  // 3. Fresh agent (session key) EOA. The agent is a pure signer on the buyer
  //    side: it signs commitments / redelegations OFF-CHAIN (EIP-712), and
  //    never sends an on-chain tx (the SELLER redeems and pays gas). So it
  //    needs no ETH.
  const agentPrivateKey = generatePrivateKey();
  const agent = privateKeyToAccount(agentPrivateKey);

  // 4. Root Erc20PeriodTransfer delegation treasury → agent, signed by treasury.
  const delegation = createDelegation({
    scope: {
      type: ScopeType.Erc20PeriodTransfer,
      tokenAddress: USDC,
      periodAmount: capAtoms,
      periodDuration: periodSeconds,
      startDate: START_DATE,
    },
    to: agent.address,
    from: treasury.address,
    environment: e,
  });
  const signature = await treasury.signDelegation({ delegation });
  const rootSignedDelegation: Delegation = { ...delegation, signature };

  // Chain so far (leaf-first = root only): [treasury→agent].
  const chainLeafFirst: Delegation[] = [rootSignedDelegation];
  const permissionContext = encodePermissionContext(chainLeafFirst);

  return {
    treasuryAddress: treasury.address,
    agentPrivateKey,
    agentAddress: agent.address,
    rootSignedDelegation,
    permissionContext,
    capAtoms,
    periodSeconds,
    startDate: START_DATE,
    chain: chainLeafFirst,
  };
}

export { START_DATE as SESSION_START_DATE };
