/**
 * chain.test.ts — verifies network selection (SIP_NETWORK → mainnet vs testnet)
 * and that the derived USDC / 1Shot / RPC config resolve consistently.
 */
import { describe, it, expect, vi } from "vitest";
import {
  SIP_NETWORK,
  IS_MAINNET,
  CHAIN,
  CHAIN_ID,
  USDC,
  USDC_DECIMALS,
  toUsdcAtoms,
  ONESHOT_TARGET_ADDRESS,
  ONESHOT_FEE_COLLECTOR,
  VENICE_PAYTO,
  DEFAULT_RPC_URL,
} from "./chain.js";

describe("chain config", () => {
  it("defaults to base-sepolia", () => {
    expect(SIP_NETWORK).toBe("base-sepolia");
    expect(IS_MAINNET).toBe(false);
    expect(CHAIN_ID).toBe(84532);
    expect(CHAIN.id).toBe(84532);
  });

  it("uses the Sepolia (Circle) USDC address by default", () => {
    expect(USDC).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(USDC_DECIMALS).toBe(6);
  });

  it("converts USD to USDC atoms (6 decimals)", () => {
    expect(toUsdcAtoms(0.1)).toBe(100000n);
    expect(toUsdcAtoms(5)).toBe(5000000n);
    expect(toUsdcAtoms(1)).toBe(1000000n);
    expect(toUsdcAtoms("0.9")).toBe(900000n);
  });

  it("leaves 1Shot / Venice constants undefined on testnet", () => {
    expect(ONESHOT_TARGET_ADDRESS).toBeUndefined();
    expect(ONESHOT_FEE_COLLECTOR).toBeUndefined();
    expect(VENICE_PAYTO).toBeUndefined();
  });

  it("has a default testnet RPC url", () => {
    expect(typeof DEFAULT_RPC_URL).toBe("string");
    expect(DEFAULT_RPC_URL.length).toBeGreaterThan(0);
  });

  it("defines mainnet constants when SIP_NETWORK=base", async () => {
    vi.stubEnv("SIP_NETWORK", "base");
    vi.resetModules();
    const m = await import("./chain.js");
    expect(m.IS_MAINNET).toBe(true);
    expect(m.CHAIN_ID).toBe(8453);
    expect(m.USDC).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(m.ONESHOT_TARGET_ADDRESS).toBeDefined();
    expect(m.ONESHOT_FEE_COLLECTOR).toBeDefined();
    expect(m.VENICE_PAYTO).toBeDefined();
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
