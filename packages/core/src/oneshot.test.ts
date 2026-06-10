/**
 * oneshot.test.ts — unit and live integration tests for the 1Shot relayer client.
 *
 * Live tests (require SIP_LIVE=1) make REAL calls to the 1Shot mainnet relayer.
 * They do NOT submit transactions — only capability and fee queries.
 *
 * Actual API response shapes (verified 2026-06-13 against live relayer):
 *
 *   getCapabilities("8453") =>
 *     { "8453": { feeCollector, targetAddress, tokens: [{address, symbol, decimals}] } }
 *
 *   getFeeData("8453", usdcAddress) =>
 *     { chainId, token, rate, minFee: "0.01", expiry, gasPrice, feeCollector, targetAddress, context }
 *     Note: minFee is a decimal string (e.g. "0.01"), not an integer atom string.
 *
 * Run with: SIP_LIVE=1 pnpm -C packages/core test oneshot
 */

import { describe, it, expect } from "vitest";
import { getCapabilities, getFeeData } from "./oneshot.js";

// Base mainnet constants (hardcoded for test assertions — these don't change)
const BASE_CHAIN_ID = "8453";
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
// Known 1Shot target contract on Base mainnet (from chain.ts ONESHOT_TARGET_ADDRESS)
const ONESHOT_TARGET = "0x26a529124f0bbf9af9d8f9f84a43efe47cf1199a" as const;

const LIVE = process.env.SIP_LIVE === "1";

describe("oneshot client — module shape", () => {
  it("exports getCapabilities, getFeeData, send7710Transaction, getStatus", async () => {
    const mod = await import("./oneshot.js");
    expect(typeof mod.getCapabilities).toBe("function");
    expect(typeof mod.getFeeData).toBe("function");
    expect(typeof mod.send7710Transaction).toBe("function");
    expect(typeof mod.getStatus).toBe("function");
  });
});

describe.skipIf(!LIVE)("1Shot live mainnet checks (SIP_LIVE=1)", () => {
  it(
    "getCapabilities('8453') includes the Base mainnet target address and a USDC token",
    { timeout: 15_000 },
    async () => {
      const caps = await getCapabilities(BASE_CHAIN_ID);

      // Response is a map keyed by chainId string
      const chainCaps = caps[BASE_CHAIN_ID];
      expect(
        chainCaps,
        `Expected capabilities for chain ${BASE_CHAIN_ID}. Got keys: ${Object.keys(caps).join(", ")}`
      ).toBeDefined();

      // Must have the known 1Shot target address
      expect(chainCaps.targetAddress.toLowerCase()).toBe(ONESHOT_TARGET.toLowerCase());

      // Must have USDC listed as a fee token
      const usdcToken = chainCaps.tokens.find(
        (t) => t.address.toLowerCase() === USDC_BASE_MAINNET.toLowerCase()
      );
      expect(
        usdcToken,
        `Expected USDC ${USDC_BASE_MAINNET} in tokens. Got: ${JSON.stringify(chainCaps.tokens)}`
      ).toBeDefined();
    }
  );

  it(
    "getFeeData('8453', USDC) returns a positive minFee and a non-empty context string",
    { timeout: 15_000 },
    async () => {
      const fee = await getFeeData(BASE_CHAIN_ID, USDC_BASE_MAINNET);

      // minFee is a decimal string (e.g. "0.01") — parse as float and check > 0
      const minFeeFloat = parseFloat(fee.minFee);
      expect(
        isNaN(minFeeFloat),
        `minFee should be a numeric string, got: ${fee.minFee}`
      ).toBe(false);
      expect(minFeeFloat).toBeGreaterThan(0);

      // context must be a non-empty string (opaque JSON blob for fee authorization)
      expect(typeof fee.context).toBe("string");
      expect(fee.context.length).toBeGreaterThan(0);

      // Sanity: token address matches USDC
      expect(fee.token.address.toLowerCase()).toBe(USDC_BASE_MAINNET.toLowerCase());
    }
  );
});
