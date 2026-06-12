/**
 * verify.ts — seller-side commitment verification (SPEC §6).
 *
 * Verification is layered:
 *   (1) payTo matches the seller this resource is sold by;
 *   (2) validBefore is in the future (commitment not expired);
 *   (3) nonce has not been seen before (off-chain replay prevention, SPEC §7);
 *   (4) ON-CHAIN SIMULATION (authoritative): eth_call-simulate the exact
 *       redeemDelegations([permissionContext],[SingleDefault],[[transfer(seller,
 *       amount)]]) from the seller. A successful simulation proves the chain is
 *       well-formed, signatures validate to the root delegator, the leaf
 *       authorizes this seller, the delegation is not revoked, and the draw is
 *       within the on-chain remaining period budget (ERC20PeriodTransferEnforcer).
 *       A reverting simulation ⇒ invalid, with the decoded revert reason. This is
 *       the x402 / erc7710 "verify by simulation" approach and subsumes the
 *       remaining-budget check of SPEC §6.3.
 *
 * Optionally we also read getErc20PeriodTransferEnforcerAvailableAmount on the
 * ROOT delegation for a friendlier budget message, but the simulation is the
 * authority: if it passes, the redemption (or batch redemption) will succeed.
 */

import {
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  contracts,
  createExecution,
  ExecutionMode,
  getSmartAccountsEnvironment,
  type PermissionContext,
} from "@metamask/smart-accounts-kit";
import { decodeRevertReason } from "@metamask/smart-accounts-kit/utils";

import {
  USDC,
  CHAIN,
  CHAIN_ID,
  DEFAULT_RPC_URL,
  buildTransferExecution,
} from "@sip402/core";
import type { Commitment } from "@sip402/client";

export interface VerifyResult {
  isValid: boolean;
  invalidReason?: string;
  /** The root delegator (the buyer treasury) when known. */
  payer?: Address;
}

/**
 * Simulate redeeming a single commitment from `seller` for `amount` atoms via
 * eth_call against the DelegationManager. Returns ok=false with a decoded reason
 * when it reverts (revoked, over-budget, malformed, wrong leaf, etc.).
 */
export async function simulateRedeem(opts: {
  permissionContext: Hex;
  seller: Address;
  amount: bigint;
  rpcUrl?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { permissionContext, seller, amount, rpcUrl = DEFAULT_RPC_URL } = opts;
  const env = getSmartAccountsEnvironment(CHAIN_ID);
  const publicClient = createPublicClient({ chain: CHAIN, transport: http(rpcUrl) });

  const transfer = buildTransferExecution(seller, amount);
  const execution = createExecution({
    target: transfer.target,
    value: transfer.value,
    callData: transfer.callData,
  });

  const data = contracts.DelegationManager.encode.redeemDelegations({
    delegations: [permissionContext as PermissionContext],
    modes: [ExecutionMode.SingleDefault],
    executions: [[execution]],
  });

  try {
    await publicClient.call({
      account: seller,
      to: env.DelegationManager as Address,
      data,
    });
    return { ok: true };
  } catch (err) {
    const decoded = decodeRevertReason(err);
    const message = decoded
      ? `${decoded.errorName}: ${decoded.message}`
      : err instanceof Error
        ? err.message.split("\n")[0]
        : String(err);
    return { ok: false, reason: message };
  }
}

export async function verifyCommitment(opts: {
  commitment: Commitment;
  expectedPayTo: Address;
  usedNonces: Set<string>;
  /** The seller EOA that will redeem (msg.sender of the simulation). */
  seller?: Address;
  rpcUrl?: string;
}): Promise<VerifyResult> {
  const { commitment, expectedPayTo, usedNonces, rpcUrl = DEFAULT_RPC_URL } = opts;
  const seller = opts.seller ?? expectedPayTo;

  // (1) payTo must be this seller.
  if (commitment.payTo.toLowerCase() !== expectedPayTo.toLowerCase()) {
    return {
      isValid: false,
      invalidReason: `payTo mismatch: commitment pays ${commitment.payTo}, expected ${expectedPayTo}`,
      payer: commitment.delegator,
    };
  }

  // (2) validBefore in the future.
  const nowSec = Math.floor(Date.now() / 1000);
  const validBefore = Number(commitment.validBefore);
  if (!Number.isFinite(validBefore) || validBefore <= nowSec) {
    return {
      isValid: false,
      invalidReason: `commitment expired: validBefore ${commitment.validBefore} <= now ${nowSec}`,
      payer: commitment.delegator,
    };
  }

  // (3) nonce not seen before (replay prevention, SPEC §7 off-chain layer).
  if (usedNonces.has(commitment.nonce.toLowerCase())) {
    return {
      isValid: false,
      invalidReason: `nonce already used: ${commitment.nonce}`,
      payer: commitment.delegator,
    };
  }

  // (4) On-chain simulation (authoritative): proves chain validity, leaf
  // authorization, non-revocation, and remaining-budget in one eth_call.
  const sim = await simulateRedeem({
    permissionContext: commitment.permissionContext,
    seller,
    amount: BigInt(commitment.amount),
    rpcUrl,
  });
  if (!sim.ok) {
    return {
      isValid: false,
      invalidReason: `redeem simulation reverted: ${sim.reason ?? "unknown"}`,
      payer: commitment.delegator,
    };
  }

  return { isValid: true, payer: commitment.delegator };
}
