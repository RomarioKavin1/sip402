export interface SipMeterOptions {
  minBatchAtoms: bigint;
  capAtoms: bigint;
}

/**
 * SipMeter — pure-logic draw-batching accounting for a sip402 session.
 *
 * Tracks cumulative cost (owed) against a session cap (capAtoms).
 * Only triggers an on-chain draw when the accrued amount reaches minBatchAtoms,
 * batching micro-costs to reduce transaction frequency and gas.
 *
 * All amounts are bigint USDC atoms (6 decimal places, e.g. 1_000_000n = $1.00).
 */
export class SipMeter {
  readonly #minBatch: bigint;
  readonly #cap: bigint;
  #owed: bigint = 0n;
  #drawn: bigint = 0n;

  constructor({ minBatchAtoms, capAtoms }: SipMeterOptions) {
    this.#minBatch = minBatchAtoms;
    this.#cap = capAtoms;
  }

  /** Accrued cost not yet drawn (pending batch). Read-only — mutated only via record/flush. */
  get owed(): bigint {
    return this.#owed;
  }

  /** Total atoms drawn (settled on-chain) so far. Read-only — mutated only via record/flush. */
  get drawn(): bigint {
    return this.#drawn;
  }

  /** Atoms remaining before the session cap is exhausted. */
  get remaining(): bigint {
    return this.#cap - this.#drawn;
  }

  /** True when drawn >= cap (no more budget). */
  get isDry(): boolean {
    return this.#drawn >= this.#cap;
  }

  /**
   * Record a sip cost.
   *
   * - Throws `"session dry"` if the meter is already exhausted.
   * - Accrues the cost to `owed`.
   * - If `owed >= minBatchAtoms`, triggers a flush and returns the draw amount.
   * - Otherwise returns null.
   */
  record(costAtoms: bigint): bigint | null {
    if (this.isDry) throw new Error("session dry");
    this.#owed += costAtoms;
    if (this.#owed >= this.#minBatch) {
      return this.flush();
    }
    return null;
  }

  /**
   * Flush any accrued owed amount now (regardless of minBatch).
   *
   * Draws `min(owed, remaining)`, updates owed/drawn, and returns the draw
   * amount, or null if nothing was owed.
   */
  flush(): bigint | null {
    if (this.#owed === 0n) return null;
    const draw = this.#owed < this.remaining ? this.#owed : this.remaining;
    this.#owed = 0n;
    this.#drawn += draw;
    return draw === 0n ? null : draw;
  }
}
