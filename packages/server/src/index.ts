/**
 * @sip402/server — the SELLER side of the sip402 x402 `batch-settlement` binding.
 *
 * Verify commitments (verify-by-simulation, SPEC §6), accumulate them
 * (SPEC §5.2), and redeem them in BATCHES (SPEC §5.3) — N commitments → ONE
 * redeemDelegations tx. Plus the x402 HTTP middleware and an SSE settlement feed.
 */

export {
  verifyCommitment,
  simulateRedeem,
  type VerifyResult,
} from "./verify.js";

export {
  CommitmentAccumulator,
  countTransfersTo,
  type SettlementEvent,
} from "./accumulator.js";

export {
  x402BatchSettlement,
  encodeBase64Json,
  decodeBase64Json,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_RESPONSE_HEADER,
  type PaymentRequired,
  type PaymentPayload,
  type SettlementResponse,
} from "./middleware.js";

export {
  SettlementBus,
  sseHandler,
  webhookHandler,
  type OneShotWebhookPayload,
  type OneShotStatusListener,
} from "./events.js";
