/**
 * chain.ts — network + token configuration for sip402.
 *
 * sip402 runs on two networks and the active one is selected ONCE here, at
 * module load, from the SIP_NETWORK env var:
 *   - "base"         → Base mainnet (chainId 8453) — gasless settlement via 1Shot.
 *   - "base-sepolia" → Base Sepolia (chainId 84532, default) — direct redemption.
 *
 * Every downstream module (settler selection, USDC address, RPC, 1Shot wiring)
 * keys off these exports, so flipping SIP_NETWORK reconfigures the whole stack.
 * The ONESHOT and VENICE mainnet-only constants are intentionally `undefined`
 * on testnet, which is how callers detect "no gasless relayer available here".
 */

import { parseUnits, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";

export type SipNetwork = "base" | "base-sepolia";

// Network is resolved once at load. Anything other than an explicit "base"
// falls back to the safe testnet default (base-sepolia).
export const SIP_NETWORK: SipNetwork =
  (process.env.SIP_NETWORK as SipNetwork) === "base" ? "base" : "base-sepolia";
export const IS_MAINNET = SIP_NETWORK === "base";

export const CHAIN = IS_MAINNET ? base : baseSepolia;
export const CHAIN_ID = IS_MAINNET ? 8453 : 84532;
/** USDC has 6 decimals on Base — 1 atom = 1e-6 USDC, so 1_000_000n = $1.00. */
export const USDC_DECIMALS = 6;

// USDC token contract: Base mainnet (Circle native) vs Base Sepolia (Circle test token).
export const USDC: Address = IS_MAINNET
  ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// 1Shot relayer wiring (MAINNET ONLY — `undefined` on testnet).
// ONESHOT_TARGET_ADDRESS is the relayer's redemption account: the mainnet
// delegation's `to` MUST equal it (see oneshot.ts ChainCapabilities.targetAddress).
// ONESHOT_FEE_COLLECTOR is where the per-redeem USDC gas fee is paid.
export const ONESHOT_TARGET_ADDRESS = IS_MAINNET
  ? ("0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a" as Address)
  : undefined;
export const ONESHOT_FEE_COLLECTOR = IS_MAINNET
  ? ("0xE936e8FAf4A5655469182A49a505055B71C17604" as Address)
  : undefined;
export const ONESHOT_RELAYER_URL = "https://relayer.1shotapi.com/relayers";

// Venice (the paid inference seller used in the demo) payTo (MAINNET ONLY).
export const VENICE_PAYTO = IS_MAINNET
  ? ("0x2670b922ef37c7df47158725c0cc407b5382293f" as Address)
  : undefined;

// RPC endpoint — env override first, then the public Base/Base Sepolia node.
export const DEFAULT_RPC_URL = IS_MAINNET
  ? (process.env.BASE_RPC_URL ?? "https://mainnet.base.org")
  : (process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");

/** Convert a human USDC value ($) to integer atoms (6 decimals). */
export function toUsdcAtoms(usd: number | string): bigint {
  return parseUnits(usd.toString(), USDC_DECIMALS);
}
