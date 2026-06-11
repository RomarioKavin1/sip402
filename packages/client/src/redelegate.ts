/**
 * redelegate.ts — A2A attenuation: insert an extra delegate hop.
 *
 * The current session's agent (an EOA delegate) redelegates a NARROWER
 * sub-budget to a fresh specialist agent EOA. This extends the chain by one
 * hop: e.g. treasury → orchestrator(agent) → specialist. The child cap MUST be
 * ≤ the parent cap; the on-chain ERC20PeriodTransferEnforcer enforces it too.
 *
 * Because the parent agent is an EOA (the delegate of the parent delegation),
 * it can itself sign a child delegation. We sign with the kit's standalone
 * `signDelegation({ privateKey, ... })` (EIP-712), which works for an EOA
 * delegator — exactly the recurring-payments redelegation pattern.
 *
 * The child delegation's `authority` is bound to the parent via
 * `parentDelegation`, so the chain validates root → … → child on redemption.
 *
 * Chain ordering: leaf-first. The returned session.chain is
 *   [child(specialist), …, root(treasury)]  (new leaf prepended).
 */

import { type Address, type Hex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  createDelegation,
  signDelegation as signDelegationStandalone,
  ScopeType,
  type Delegation,
} from "@metamask/smart-accounts-kit";

import { USDC, toUsdcAtoms, DEFAULT_RPC_URL } from "@sip402/core";
import { env, chainId, encodePermissionContext } from "./internal.js";
import type { Session } from "./session.js";

export async function redelegateSession(opts: {
  parentSession: Session;
  childCapUsd: number;
  periodSeconds: number;
  rpcUrl?: string;
}): Promise<Session> {
  const { parentSession, childCapUsd, periodSeconds, rpcUrl = DEFAULT_RPC_URL } = opts;

  const childCapAtoms = toUsdcAtoms(childCapUsd);
  if (childCapAtoms > parentSession.capAtoms) {
    throw new Error(
      `childCapUsd (${childCapUsd}) exceeds parent cap (${Number(parentSession.capAtoms) / 1e6}); ` +
        "a redelegation can only narrow authority",
    );
  }

  void rpcUrl; // redelegation is a pure off-chain signing operation
  const e = env();

  // Parent agent EOA = delegator of the new (child) delegation.
  const parentAgent = privateKeyToAccount(parentSession.agentPrivateKey);

  // Fresh specialist agent EOA. Like the agent, the specialist is a pure
  // off-chain signer (it signs the commitment to the seller); the SELLER
  // redeems and pays gas. So the specialist needs no ETH.
  const specialistPrivateKey = generatePrivateKey();
  const specialist = privateKeyToAccount(specialistPrivateKey);

  // The parent delegation this child attenuates = current leaf of parent chain.
  const parentLeaf = (parentSession.chain as Delegation[])[0]!;

  // Child delegation: parentAgent → specialist, authority bound to parentLeaf.
  const childDelegation = createDelegation({
    scope: {
      type: ScopeType.Erc20PeriodTransfer,
      tokenAddress: USDC,
      periodAmount: childCapAtoms,
      periodDuration: periodSeconds,
      startDate: parentSession.startDate,
    },
    to: specialist.address,
    from: parentAgent.address,
    parentDelegation: parentLeaf,
    environment: e,
  });

  // The parent agent EOA signs the child delegation (EOA-as-delegator).
  const childSignature = await signDelegationStandalone({
    privateKey: parentSession.agentPrivateKey,
    delegation: childDelegation,
    delegationManager: e.DelegationManager as Address,
    chainId,
  });
  const childSigned: Delegation = { ...childDelegation, signature: childSignature };

  // New leaf-first chain: prepend child to the parent chain.
  const chainLeafFirst: Delegation[] = [childSigned, ...(parentSession.chain as Delegation[])];
  const permissionContext = encodePermissionContext(chainLeafFirst);

  return {
    treasuryAddress: parentSession.treasuryAddress,
    agentPrivateKey: specialistPrivateKey,
    agentAddress: specialist.address,
    rootSignedDelegation: parentSession.rootSignedDelegation,
    permissionContext,
    capAtoms: childCapAtoms,
    periodSeconds,
    startDate: parentSession.startDate,
    chain: chainLeafFirst,
  };
}
