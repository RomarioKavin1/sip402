/**
 * session.test.ts — SipMeter accounting: owed accrual, minBatch flush trigger,
 * cap clamping, and the "session dry" guard.
 */
import { describe, it, expect } from "vitest";
import { SipMeter } from "./session.js";

describe("SipMeter", () => {
  describe("accrues owed cost; only flushes a draw when minBatch reached", () => {
    it("returns null when owed < minBatchAtoms", () => {
      const m = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      expect(m.record(100000n)).toBeNull(); // $0.10 owed, < $0.25 batch
      expect(m.owed).toBe(100000n);
      expect(m.drawn).toBe(0n);
    });

    it("still returns null at $0.20 (still < $0.25 batch)", () => {
      const m = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      m.record(100000n);
      expect(m.record(100000n)).toBeNull();
      expect(m.owed).toBe(200000n);
      expect(m.drawn).toBe(0n);
    });

    it("flushes at $0.30 (>= $0.25 batch), resets owed, updates drawn", () => {
      const m = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      m.record(100000n);
      m.record(100000n);
      const draw = m.record(100000n); // $0.30 owed >= $0.25 batch => flush $0.30
      expect(draw).toBe(300000n);
      expect(m.owed).toBe(0n);
      expect(m.drawn).toBe(300000n);
    });
  });

  describe("caps the final draw at remaining budget and reports dry", () => {
    it("first record flushes normally at $0.30", () => {
      const m2 = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 400000n });
      expect(m2.record(300000n)).toBe(300000n); // flush $0.30
      expect(m2.drawn).toBe(300000n);
      expect(m2.isDry).toBe(false);
    });

    it("second record caps at remaining $0.10 and marks dry", () => {
      const m2 = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 400000n });
      m2.record(300000n); // draw $0.30
      const draw = m2.record(300000n); // only $0.10 left under $0.40 cap
      expect(draw).toBe(100000n);
      expect(m2.isDry).toBe(true);
    });

    it("throws 'session dry' when record called after dry", () => {
      const m2 = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 400000n });
      m2.record(300000n);
      m2.record(300000n);
      expect(() => m2.record(1n)).toThrow("session dry");
    });
  });

  describe("flush() drains any sub-batch remainder", () => {
    it("flush returns the owed sub-batch amount and zeroes owed", () => {
      const m3 = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      m3.record(100000n);
      const draw = m3.flush();
      expect(draw).toBe(100000n);
      expect(m3.owed).toBe(0n);
      expect(m3.drawn).toBe(100000n);
    });

    it("flush returns null when nothing owed", () => {
      const m3 = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      m3.record(100000n);
      m3.flush();
      expect(m3.flush()).toBeNull();
    });
  });

  describe("remaining getter", () => {
    it("returns cap - drawn", () => {
      const m = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      expect(m.remaining).toBe(1000000n);
      m.record(100000n);
      m.record(100000n);
      m.record(100000n); // draws 300000n
      expect(m.remaining).toBe(700000n);
    });
  });

  describe("isDry getter", () => {
    it("is false when drawn < cap", () => {
      const m = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      expect(m.isDry).toBe(false);
    });

    it("is true when drawn >= cap", () => {
      const m = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 300000n });
      m.record(300000n); // drawn = 300000n = cap
      expect(m.isDry).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("record with exact minBatch amount flushes immediately", () => {
      const m = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      expect(m.record(250000n)).toBe(250000n);
    });

    it("flush after auto-flush returns null (owed already 0)", () => {
      const m = new SipMeter({ minBatchAtoms: 250000n, capAtoms: 1000000n });
      m.record(300000n); // auto-flushes
      expect(m.flush()).toBeNull();
    });

    it("accumulated owed caps at remaining on flush", () => {
      const m = new SipMeter({ minBatchAtoms: 50000n, capAtoms: 200000n });
      m.record(100000n); // draws 100000n (remaining=100000n)
      m.record(50000n);  // draws 50000n  (remaining=50000n)
      m.record(10000n);  // owed=10000n, < 50000n batch, no flush
      const draw = m.flush(); // flush remaining: min(10000n, 50000n) = 10000n
      expect(draw).toBe(10000n);
      expect(m.drawn).toBe(160000n);
      expect(m.isDry).toBe(false);
    });

    it("when owed > remaining on flush, caps the draw at remaining", () => {
      const m = new SipMeter({ minBatchAtoms: 10000n, capAtoms: 150000n });
      m.record(100000n); // drawn=100000n
      // Add enough owed to exceed remaining (remaining=50000n)
      // record 30000n: owed=30000n, 30000n >= 10000n => flush, but cap at remaining=50000n
      m.record(30000n); // draws min(30000n, 50000n) = 30000n => drawn=130000n
      // Now remaining=20000n
      // record 25000n: owed=25000n, >= 10000n => flush min(25000n, 20000n) = 20000n => dry
      const draw = m.record(25000n);
      expect(draw).toBe(20000n);
      expect(m.isDry).toBe(true);
    });
  });
});
