import { parseUnits, type Address } from "viem";
import { base, baseSepolia } from "viem/chains";

export type SipNetwork = "base" | "base-sepolia";

export const SIP_NETWORK: SipNetwork =
  (process.env.SIP_NETWORK as SipNetwork) === "base" ? "base" : "base-sepolia";
export const IS_MAINNET = SIP_NETWORK === "base";

export const CHAIN = IS_MAINNET ? base : baseSepolia;
export const CHAIN_ID = IS_MAINNET ? 8453 : 84532;
export const USDC_DECIMALS = 6;

// USDC: Base mainnet vs Base Sepolia (Circle test token)
export const USDC: Address = IS_MAINNET
  ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  : "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// 1Shot relayer (MAINNET ONLY — undefined on testnet)
export const ONESHOT_TARGET_ADDRESS = IS_MAINNET
  ? ("0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a" as Address)
  : undefined;
export const ONESHOT_FEE_COLLECTOR = IS_MAINNET
  ? ("0xE936e8FAf4A5655469182A49a505055B71C17604" as Address)
  : undefined;
export const ONESHOT_RELAYER_URL = "https://relayer.1shotapi.com/relayers";

// Venice payTo (MAINNET ONLY)
export const VENICE_PAYTO = IS_MAINNET
  ? ("0x2670b922ef37c7df47158725c0cc407b5382293f" as Address)
  : undefined;

export const DEFAULT_RPC_URL = IS_MAINNET
  ? (process.env.BASE_RPC_URL ?? "https://mainnet.base.org")
  : (process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");

export function toUsdcAtoms(usd: number | string): bigint {
  return parseUnits(usd.toString(), USDC_DECIMALS);
}
