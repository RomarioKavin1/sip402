import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { USDC } from "@sip402/core";
import type { Commitment } from "@sip402/client";

import {
  encodeBase64Json,
  decodeBase64Json,
  type PaymentRequired,
  type PaymentPayload,
  type SettlementResponse,
} from "./middleware.js";

/**
 * The PAYMENT-REQUIRED / PAYMENT-RESPONSE / PAYMENT-SIGNATURE headers are
 * base64-encoded JSON. These tests round-trip each schema (including a bigint,
 * which is serialized as a decimal string) to lock the transport encoding.
 */

const SELLER = privateKeyToAccount(generatePrivateKey()).address as Address;
const TREASURY = privateKeyToAccount(generatePrivateKey()).address as Address;

describe("x402 header base64-JSON round-trip", () => {
  it("round-trips a PaymentRequired offer", () => {
    const required: PaymentRequired = {
      scheme: "batch-settlement",
      network: "eip155:84532",
      amount: "100000",
      asset: USDC,
      payTo: SELLER,
      maxTimeoutSeconds: 300,
    };
    const decoded = decodeBase64Json<PaymentRequired>(encodeBase64Json(required));
    expect(decoded).toEqual(required);
  });

  it("serializes bigint as a decimal string", () => {
    const b64 = encodeBase64Json({ amount: 250000n });
    const decoded = decodeBase64Json<{ amount: string }>(b64);
    expect(decoded.amount).toBe("250000");
  });

  it("round-trips a PaymentPayload carrying a Commitment", () => {
    const commitment: Commitment = {
      scheme: "batch-settlement",
      network: "eip155:84532",
      delegationManager: "0x0000000000000000000000000000000000000001" as Address,
      permissionContext: "0xdeadbeef" as Hex,
      delegator: TREASURY,
      payTo: SELLER,
      amount: "100000",
      nonce: generatePrivateKey(),
      validBefore: "9999999999",
      commitmentId: "0xabc123" as Hex,
    };
    const payload: PaymentPayload = {
      scheme: "batch-settlement",
      network: "eip155:84532",
      payload: commitment,
    };
    const decoded = decodeBase64Json<PaymentPayload>(encodeBase64Json(payload));
    expect(decoded.payload).toEqual(commitment);
    expect(decoded.payload.permissionContext).toBe(commitment.permissionContext);
  });

  it("round-trips a SettlementResponse with a commitmentId extension", () => {
    const resp: SettlementResponse = {
      success: true,
      payer: TREASURY,
      transaction: "0xabc",
      network: "eip155:84532",
      extensions: { commitmentId: "0xvoucherhash" },
    };
    const decoded = decodeBase64Json<SettlementResponse>(encodeBase64Json(resp));
    expect(decoded).toEqual(resp);
    expect(decoded.extensions.commitmentId).toBe("0xvoucherhash");
  });
});
