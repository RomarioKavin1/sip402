/**
 * middleware.ts — x402 `batch-settlement` HTTP transport (Hono).
 *
 * Implements the seller's Commit-phase HTTP handshake (SPEC §5.1) using the
 * x402 HTTP header transport. Header names + base64-JSON encoding per the x402
 * HTTP transport:
 *   - PAYMENT-REQUIRED  (402 response): base64(PaymentRequired)
 *   - PAYMENT-SIGNATURE (request):       base64(PaymentPayload) carrying the Commitment
 *   - PAYMENT-RESPONSE  (200 response): base64(SettlementResponse)
 *
 * Flow:
 *   no PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED advertising the offer.
 *   PAYMENT-SIGNATURE    → decode the PaymentPayload, pull the Commitment,
 *                          accumulator.recordAndMaybeFlush(); on success serve the
 *                          resource and set PAYMENT-RESPONSE; on failure → 402.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Address } from "viem";

import { USDC, CHAIN_ID } from "@sip402/core";
import type { Commitment } from "@sip402/client";

import type { CommitmentAccumulator } from "./accumulator.js";

export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

const DEFAULT_NETWORK = CHAIN_ID === 8453 ? "eip155:8453" : "eip155:84532";

export interface PaymentRequired {
  scheme: "batch-settlement";
  network: string;
  /** Atomic USDC price for this request (decimal string). */
  amount: string;
  asset: Address;
  payTo: Address;
  maxTimeoutSeconds: number;
}

export interface PaymentPayload {
  scheme: "batch-settlement";
  network: string;
  /** The commitment (a redelegation-to-seller voucher, SPEC §4). */
  payload: Commitment;
}

export interface SettlementResponse {
  success: boolean;
  payer: Address;
  /** Batch settle tx hash if this request triggered a flush, else "". */
  transaction: string;
  network: string;
  extensions: { commitmentId: string };
  error?: string;
}

export function encodeBase64Json(value: unknown): string {
  return Buffer.from(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ).toString("base64");
}

export function decodeBase64Json<T>(b64: string): T {
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as T;
}

export function x402BatchSettlement(opts: {
  price: (c: Context) => bigint;
  payTo: Address;
  accumulator: CommitmentAccumulator;
  network?: string;
  maxTimeoutSeconds?: number;
}): MiddlewareHandler {
  const network = opts.network ?? DEFAULT_NETWORK;
  const maxTimeoutSeconds = opts.maxTimeoutSeconds ?? 300;

  return async (c, next) => {
    const sig = c.req.header(PAYMENT_SIGNATURE_HEADER);

    // No payment → 402 challenge with the offer.
    if (!sig) {
      const amount = opts.price(c);
      const required: PaymentRequired = {
        scheme: "batch-settlement",
        network,
        amount: amount.toString(),
        asset: USDC,
        payTo: opts.payTo,
        maxTimeoutSeconds,
      };
      c.header(PAYMENT_REQUIRED_HEADER, encodeBase64Json(required));
      return c.json({ error: "payment required", accepts: [required] }, 402);
    }

    // Decode the payment payload and pull the commitment.
    let commitment: Commitment;
    try {
      const payload = decodeBase64Json<PaymentPayload>(sig);
      commitment = payload.payload;
      if (!commitment || !commitment.permissionContext) {
        throw new Error("missing commitment in payload");
      }
    } catch (err) {
      return c.json(
        { error: `malformed PAYMENT-SIGNATURE: ${err instanceof Error ? err.message : String(err)}` },
        402,
      );
    }

    // Verify + accumulate (auto-flush at minBatch).
    let commitmentId: string;
    let settleTxHash: string | undefined;
    try {
      const r = await opts.accumulator.recordAndMaybeFlush(commitment);
      commitmentId = r.commitmentId;
      settleTxHash = r.settleTxHash;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failResp: SettlementResponse = {
        success: false,
        payer: commitment.delegator,
        transaction: "",
        network,
        extensions: { commitmentId: "" },
        error: message,
      };
      c.header(PAYMENT_RESPONSE_HEADER, encodeBase64Json(failResp));
      return c.json({ error: `payment verification failed: ${message}` }, 402);
    }

    // Success: serve the resource, attach the settlement response.
    const resp: SettlementResponse = {
      success: true,
      payer: commitment.delegator,
      transaction: settleTxHash ?? "",
      network,
      extensions: { commitmentId },
    };
    c.header(PAYMENT_RESPONSE_HEADER, encodeBase64Json(resp));
    await next();
  };
}
