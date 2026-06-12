import { describe, it, expect } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

import { USDC } from "@sip402/core";
import type { Commitment } from "@sip402/client";

import { verifyCommitment } from "./verify.js";

/**
 * Pure (no-chain) coverage of verify's off-chain checks: payTo mismatch,
 * expired validBefore, and used nonce. Each of these short-circuits BEFORE the
 * on-chain simulation, so no RPC is needed. The simulation path itself is
 * proven on Base Sepolia in scripts/server-proof.ts (real transactions).
 */

const SELLER = privateKeyToAccount(generatePrivateKey()).address as Address;

function makeCommitment(overrides: Partial<Commitment> = {}): Commitment {
  const treasury = privateKeyToAccount(generatePrivateKey()).address as Address;
  return {
    scheme: "batch-settlement",
    network: "eip155:84532",
    delegationManager: "0x0000000000000000000000000000000000000001" as Address,
    permissionContext: "0xdeadbeef" as Hex,
    delegator: treasury,
    payTo: SELLER,
    amount: "100000",
    nonce: generatePrivateKey(),
    validBefore: (Math.floor(Date.now() / 1000) + 3600).toString(),
    commitmentId: "0xabc123" as Hex,
    ...overrides,
  };
}

describe("verifyCommitment — off-chain checks", () => {
  it("rejects a payTo mismatch", async () => {
    const otherSeller = privateKeyToAccount(generatePrivateKey()).address as Address;
    const r = await verifyCommitment({
      commitment: makeCommitment({ payTo: otherSeller }),
      expectedPayTo: SELLER,
      usedNonces: new Set(),
    });
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toMatch(/payTo mismatch/i);
  });

  it("rejects an expired validBefore", async () => {
    const r = await verifyCommitment({
      commitment: makeCommitment({
        validBefore: (Math.floor(Date.now() / 1000) - 10).toString(),
      }),
      expectedPayTo: SELLER,
      usedNonces: new Set(),
    });
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toMatch(/expired/i);
  });

  it("rejects a used nonce (replay)", async () => {
    const c = makeCommitment();
    const r = await verifyCommitment({
      commitment: c,
      expectedPayTo: SELLER,
      usedNonces: new Set([c.nonce.toLowerCase()]),
    });
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toMatch(/nonce already used/i);
  });

  it("carries the payer (delegator) on a rejection", async () => {
    const c = makeCommitment({ payTo: "0x0000000000000000000000000000000000000009" as Address });
    const r = await verifyCommitment({ commitment: c, expectedPayTo: SELLER, usedNonces: new Set() });
    expect(r.payer).toBe(c.delegator);
  });

  it("uses the canonical USDC asset for the chain", () => {
    // sanity: the asset advertised in middleware is the core USDC constant
    expect(USDC).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
