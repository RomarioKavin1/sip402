/**
 * internal.ts — shared helpers for the @sip402/client buyer side.
 *
 * Centralises chain/env wiring and the permission-context encoding used across
 * session / redelegate / commitment so each module stays focused.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Hex,
  type Account,
} from "viem";
import {
  getSmartAccountsEnvironment,
  type Delegation,
  type SmartAccountsEnvironment,
} from "@metamask/smart-accounts-kit";
import { encodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { CHAIN, CHAIN_ID, DEFAULT_RPC_URL } from "@sip402/core";

export const chain: Chain = CHAIN;
export const chainId: number = CHAIN_ID;

export function env(): SmartAccountsEnvironment {
  return getSmartAccountsEnvironment(chainId);
}

export function publicClientFor(rpcUrl = DEFAULT_RPC_URL): PublicClient {
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export function walletClientFor(account: Account, rpcUrl = DEFAULT_RPC_URL): WalletClient {
  return createWalletClient({ account, chain, transport: http(rpcUrl) });
}

/**
 * ABI-encode a signed delegation chain into the `permissionContext` blob that
 * `redeemDelegations` consumes. The chain MUST be ordered leaf-first
 * (most-derived delegation first, root delegator last) — the ERC-7710
 * DelegationManager convention, confirmed empirically on Base Sepolia.
 */
export function encodePermissionContext(chainLeafFirst: Delegation[]): Hex {
  return encodeDelegations(chainLeafFirst);
}
