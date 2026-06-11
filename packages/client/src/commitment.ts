/**
 * commitment.ts — createCommitment: the x402 `batch-settlement` PAYMENT.
 *
 * A commitment is a REDELEGATION to the seller (SPEC §4): the session's agent
 * (the current chain leaf's delegate, an EOA) creates and signs a child
 * delegation `agent → seller` scoped to this request's `amount`, extending the
 * delegation chain so the SELLER can redeem it WITHOUT trusting the buyer.
 *
 * The commitment delegation carries an Erc20PeriodTransfer scope capped at
 * `amount` for this leaf, so even the seller's own redemption can draw at most
 * `amount` through this voucher; the cumulative session ceiling is still
 * enforced by the root ERC20PeriodTransferEnforcer.
 *
 * The returned `permissionContext` is the ABI-encoded FULL chain, leaf-first:
 *   [seller-leaf, …, treasury-root]
 * which is exactly what `redeemDelegations({ delegations: [chain] })` consumes.
 *
 * `commitmentId` is keccak256 of the canonical commitment fields (the voucher
 * hash, SPEC §9) — the identifier returned at Commit time (NOT a tx hash,
 * because value has not yet moved).
 */

import {
  keccak256,
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  createDelegation,
  signDelegation as signDelegationStandalone,
  ScopeType,
  type Delegation,
} from "@metamask/smart-accounts-kit";

import { USDC, DEFAULT_RPC_URL, SIP_NETWORK } from "@sip402/core";
import { env, chainId, encodePermissionContext } from "./internal.js";
import type { Session } from "./session.js";

const NETWORK_EIP155 = SIP_NETWORK === "base" ? "eip155:8453" : "eip155:84532";

export interface Commitment {
  scheme: "batch-settlement";
  network: string;
  /** ERC-7710 Delegation Manager the seller calls to redeem (SPEC §4). */
  delegationManager: Address;
  /** ABI-encoded signed chain treasury → … → seller, leaf-first. */
  permissionContext: Hex;
  /** Root delegator (the treasury). */
  delegator: Address;
  /** The seller authorized to redeem this voucher. */
  payTo: Address;
  /** Atomic USDC authorized for this commitment (decimal string). */
  amount: string;
  /** Unique per commitment (replay prevention). */
  nonce: Hex;
  /** Commitment expiry, unix seconds as a decimal string (SPEC §4). */
  validBefore: string;
  /** keccak256 of the canonical commitment fields (the voucher hash). */
  commitmentId: Hex;
}

export async function createCommitment(opts: {
  session: Session;
  sellerAddress: Address;
  amountAtoms: bigint;
  validForSeconds?: number;
  rpcUrl?: string;
}): Promise<Commitment> {
  const {
    session,
    sellerAddress,
    amountAtoms,
    validForSeconds = 3600,
    rpcUrl = DEFAULT_RPC_URL,
  } = opts;

  void rpcUrl; // no on-chain call needed to build a commitment (off-chain voucher)

  if (amountAtoms > session.capAtoms) {
    throw new Error(
      `amount (${amountAtoms}) exceeds session cap (${session.capAtoms}); ` +
        "a commitment cannot authorize more than the agent's remaining budget",
    );
  }

  const e = env();

  // The agent is the delegate of the current chain leaf — it signs the
  // commitment (agent → seller), extending the chain by one hop.
  const agent = privateKeyToAccount(session.agentPrivateKey);
  const parentLeaf = (session.chain as Delegation[])[0]!;

  // Unique nonce per commitment (replay prevention) — also used as the
  // delegation SALT so each commitment is a DISTINCT leaf with its own
  // ERC20PeriodTransferEnforcer allowance. Without a unique salt, repeated
  // commitments to the same seller/amount collapse to ONE delegation hash and
  // the second redemption reverts against the leaf cap; the cumulative ceiling
  // is still enforced by the shared ROOT delegation.
  const nonce = generatePrivateKey(); // 32 random bytes
  const validBefore = Math.floor(Date.now() / 1000) + validForSeconds;

  const commitmentDelegation = createDelegation({
    scope: {
      type: ScopeType.Erc20PeriodTransfer,
      tokenAddress: USDC,
      periodAmount: amountAtoms,
      periodDuration: session.periodSeconds,
      startDate: session.startDate,
    },
    to: sellerAddress,
    from: agent.address,
    parentDelegation: parentLeaf,
    salt: nonce,
    environment: e,
  });

  const signature = await signDelegationStandalone({
    privateKey: session.agentPrivateKey,
    delegation: commitmentDelegation,
    delegationManager: e.DelegationManager as Address,
    chainId,
  });
  const commitmentSigned: Delegation = { ...commitmentDelegation, signature };

  // Full chain, leaf-first: [seller-leaf, …, treasury-root].
  const chainLeafFirst: Delegation[] = [commitmentSigned, ...(session.chain as Delegation[])];
  const permissionContext = encodePermissionContext(chainLeafFirst);

  // Voucher hash: keccak256 of canonical fields (SPEC §9).
  const commitmentId = keccak256(
    encodeAbiParameters(
      [
        { type: "address", name: "delegator" },
        { type: "address", name: "payTo" },
        { type: "uint256", name: "amount" },
        { type: "bytes32", name: "nonce" },
        { type: "uint256", name: "validBefore" },
        { type: "bytes", name: "permissionContext" },
      ],
      [
        session.treasuryAddress,
        sellerAddress,
        amountAtoms,
        nonce,
        BigInt(validBefore),
        permissionContext,
      ],
    ),
  );

  return {
    scheme: "batch-settlement",
    network: NETWORK_EIP155,
    delegationManager: e.DelegationManager as Address,
    permissionContext,
    delegator: session.treasuryAddress,
    payTo: sellerAddress,
    amount: amountAtoms.toString(),
    nonce,
    validBefore: validBefore.toString(),
    commitmentId,
  };
}
