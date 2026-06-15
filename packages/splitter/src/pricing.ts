/**
 * pricing.ts — USDC token pricing for the splitter gateway.
 *
 * USDC_PER_1K_TOKENS: atomic USDC units (6 decimals) charged per 1000 tokens.
 *   2000n = $0.002 per 1k tokens — similar to GPT-3.5-turbo pricing.
 *
 * tokenCostAtoms(tokens): exact per-call cost, integer math, rounded up.
 * ATOMS_PER_TOKEN: the per-token unit cost (USDC_PER_1K_TOKENS / 1000, min 1),
 *   used where a single-token granularity is needed (e.g. the streaming drawer).
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
