/**
 * index.ts — public surface of @sip402/client (the buyer side).
 *
 * The buyer's lifecycle, in order:
 *   - openSession        grant the ROOT periodic delegation treasury → agent (capped per period)
 *   - redelegateSession  A2A: narrow a sub-budget to a fresh specialist agent (extra chain hop)
 *   - createCommitment   the x402 batch-settlement PAYMENT — redelegation agent → seller
 *   - revokeSession      disable the root delegation on-chain (cancels all derived chains)
 *
 * The seller half (settlement) lives in @sip402/core.
 */
export type { Session } from "./session.js";
export { openSession } from "./session.js";

export { redelegateSession } from "./redelegate.js";

export type { Commitment } from "./commitment.js";
export { createCommitment } from "./commitment.js";

export { revokeSession } from "./revoke.js";
