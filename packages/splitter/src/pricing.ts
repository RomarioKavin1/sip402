/**
 * pricing.ts — USDC token pricing for the splitter gateway.
 *
 * USDC_PER_1K_TOKENS: atomic USDC units (6 decimals) charged per 1000 tokens.
 *   2000n = $0.002 per 1k tokens — similar to GPT-3.5-turbo pricing.
 *
 * For the proof script (testnet, localUpstream), a higher price constant is used
 * so the $0.25 batch threshold is crossed within a short local stream.
 * The PROOF_PRICE_PER_TOKEN export is used by the proof script directly.
 */

/** Atomic USDC per 1,000 tokens. 2000n = $0.002 / 1k tokens. */
export const USDC_PER_1K_TOKENS = 2000n;

/**
 * Compute the cost in USDC atoms for `tokens` tokens.
 * Uses integer arithmetic: cost = tokens * USDC_PER_1K_TOKENS / 1000.
 * Rounds up (ceiling) to avoid accumulating rounding loss on small chunks.
 */
export function tokenCostAtoms(tokens: number): bigint {
  if (tokens <= 0) return 0n;
  const n = BigInt(tokens);
  // Ceiling division: (n * PRICE + 999) / 1000
  return (n * USDC_PER_1K_TOKENS + 999n) / 1000n;
}

/**
 * Cost per single token in atoms (for use in proof scripts that need fine control).
 * = USDC_PER_1K_TOKENS / 1000, rounded up to 1 if < 1.
 */
export const ATOMS_PER_TOKEN: bigint =
  USDC_PER_1K_TOKENS >= 1000n ? USDC_PER_1K_TOKENS / 1000n : 1n;
