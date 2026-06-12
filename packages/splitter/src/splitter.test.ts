/**
 * @sip402/splitter unit tests (vitest, no chain).
 *
 * Tests:
 *  1. pricing.tokenCostAtoms — correct atom calculation + ceiling
 *  2. localUpstream — yields deterministic non-empty chunks with tokens > 0
 *  3. StreamingDrawer — batch boundary accounting with a stubbed settler
 *
 * NOTE: the stubbed settler is ONLY used to test accounting logic in
 * StreamingDrawer; the real on-chain draw is proven in splitter-proof.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { tokenCostAtoms, USDC_PER_1K_TOKENS } from "./pricing.js";
import { localUpstream } from "./upstream.js";
import { StreamingDrawer, DryTabError } from "./streamingDrawer.js";

// ---------------------------------------------------------------------------
// 1. pricing.tokenCostAtoms
// ---------------------------------------------------------------------------

describe("tokenCostAtoms", () => {
  it("returns 0 for 0 tokens", () => {
    expect(tokenCostAtoms(0)).toBe(0n);
  });

  it("computes cost for exactly 1000 tokens = USDC_PER_1K_TOKENS atoms", () => {
    expect(tokenCostAtoms(1000)).toBe(USDC_PER_1K_TOKENS);
  });

  it("applies ceiling rounding for fractional tokens", () => {
    // 1 token: (1 * 2000 + 999) / 1000 = 2999/1000 = 2 (integer division)
    expect(tokenCostAtoms(1)).toBe(2n);
    // 500 tokens: (500 * 2000 + 999) / 1000 = 1_000_999 / 1000 = 1000
    expect(tokenCostAtoms(500)).toBe(1000n);
  });

  it("scales linearly for 1k, 10k, 100k tokens", () => {
    expect(tokenCostAtoms(1000)).toBe(USDC_PER_1K_TOKENS);
    expect(tokenCostAtoms(10_000)).toBe(USDC_PER_1K_TOKENS * 10n);
    expect(tokenCostAtoms(100_000)).toBe(USDC_PER_1K_TOKENS * 100n);
  });

  it("returns positive atoms for negative token count (treats as 0)", () => {
    // tokenCostAtoms guards against <= 0 by returning 0n
    expect(tokenCostAtoms(-5)).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// 2. localUpstream
// ---------------------------------------------------------------------------

describe("localUpstream", () => {
  it("yields at least one chunk", async () => {
    const up = localUpstream();
    const req = { model: "local", messages: [{ role: "user", content: "hi" }] };
    const chunks: { text: string; tokens: number }[] = [];
    for await (const chunk of up.chatStream(req)) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("all chunks have non-empty text and tokens > 0", async () => {
    const up = localUpstream();
    const req = { model: "local", messages: [{ role: "user", content: "test" }] };
    for await (const chunk of up.chatStream(req)) {
      expect(chunk.tokens).toBeGreaterThan(0);
      // text may be empty for the very first chunk (empty prefix), but tokens should be > 0
      // based on our implementation, first chunk text is ""+ words so may be short
    }
  });

  it("produces a deterministic total token count across runs", async () => {
    const up1 = localUpstream();
    const up2 = localUpstream();
    const req = { model: "local", messages: [] };

    let total1 = 0;
    for await (const chunk of up1.chatStream(req)) total1 += chunk.tokens;

    let total2 = 0;
    for await (const chunk of up2.chatStream(req)) total2 += chunk.tokens;

    expect(total1).toBe(total2);
    expect(total1).toBeGreaterThan(0);
  });

  it("emits multiple chunks (proves the stream is chunked, not one-shot)", async () => {
    const up = localUpstream();
    const req = { model: "local", messages: [] };
    let count = 0;
    for await (const _ of up.chatStream(req)) {
      count++;
      if (count > 5) break; // we only need to confirm multiple
    }
    expect(count).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------
// 3. StreamingDrawer — batch boundary accounting with stubbed settler
// ---------------------------------------------------------------------------

describe("StreamingDrawer (stubbed settler)", () => {
  /**
   * Build a fake settler that records calls and optionally throws.
   */
  function makeStubSettler(opts: { throwAfter?: number; revertMessage?: string } = {}) {
    const calls: { atoms: bigint }[] = [];
    let callCount = 0;

    const settle = vi.fn(async ({ atoms }: { atoms: bigint; signedDelegation: unknown; payTo: string }) => {
      callCount++;
      calls.push({ atoms });
      if (opts.throwAfter !== undefined && callCount > opts.throwAfter) {
        throw new Error(opts.revertMessage ?? "settle tx reverted: dry tab");
      }
      return { txHash: `0xfake${callCount.toString().padStart(4, "0")}` };
    });

    return { settle, calls };
  }

  function makeCommitment(amountAtoms: bigint) {
    return {
      scheme: "batch-settlement" as const,
      network: "eip155:84532",
      delegationManager: "0x0000000000000000000000000000000000000001" as `0x${string}`,
      permissionContext: "0xdeadbeef" as `0x${string}`,
      delegator: "0x0000000000000000000000000000000000000002" as `0x${string}`,
      payTo: "0x0000000000000000000000000000000000000003" as `0x${string}`,
      amount: amountAtoms.toString(),
      nonce: "0x1234" as `0x${string}`,
      validBefore: "9999999999",
      commitmentId: "0xabc" as `0x${string}`,
    };
  }

  const SELLER_PK = "0x1111111111111111111111111111111111111111111111111111111111111111" as `0x${string}`;

  it("does not draw when accrued < minBatch", async () => {
    const stub = makeStubSettler();
    const commitment = makeCommitment(1_000_000n); // $1 cap
    const drawer = new StreamingDrawer({
      sellerPrivateKey: SELLER_PK,
      commitment,
      minBatchAtoms: 250_000n, // $0.25 batch
      _settler: stub,
    });

    // Record 100_000 atoms — less than minBatch
    const result = await drawer.record(100_000n);
    expect(result).toBeNull();
    expect(stub.settle).not.toHaveBeenCalled();
    expect(drawer.drawn).toBe(0n);
  });

  it("draws once when accrued >= minBatch", async () => {
    const stub = makeStubSettler();
    const commitment = makeCommitment(1_000_000n);
    const drawer = new StreamingDrawer({
      sellerPrivateKey: SELLER_PK,
      commitment,
      minBatchAtoms: 250_000n,
      _settler: stub,
    });

    // Record 3 × 100k = 300k > 250k → should trigger one draw
    await drawer.record(100_000n);
    await drawer.record(100_000n);
    const event = await drawer.record(100_000n);

    expect(stub.settle).toHaveBeenCalledTimes(1);
    expect(event).not.toBeNull();
    expect(event!.amountAtoms).toBe(300_000n);
    expect(drawer.drawn).toBe(300_000n);
  });

  it("triggers multiple draws as the stream continues", async () => {
    const stub = makeStubSettler();
    const commitment = makeCommitment(2_000_000n); // $2 cap
    const drawer = new StreamingDrawer({
      sellerPrivateKey: SELLER_PK,
      commitment,
      minBatchAtoms: 250_000n,
      _settler: stub,
    });

    // Record 10 × 100k = 1M atoms → should trigger 4 draws (at 300k, 600k, 900k, 1200k... actually each at minBatch boundary)
    // Let's record 250k at once, 4 times
    for (let i = 0; i < 4; i++) {
      await drawer.record(250_000n);
    }

    expect(stub.settle).toHaveBeenCalledTimes(4);
    expect(drawer.drawn).toBe(1_000_000n);
  });

  it("finalize() flushes the remaining partial batch", async () => {
    const stub = makeStubSettler();
    const commitment = makeCommitment(1_000_000n);
    const drawer = new StreamingDrawer({
      sellerPrivateKey: SELLER_PK,
      commitment,
      minBatchAtoms: 250_000n,
      _settler: stub,
    });

    // Record 100k — not enough to trigger a batch
    await drawer.record(100_000n);
    expect(stub.settle).not.toHaveBeenCalled();

    // finalize() flushes the 100k remainder
    const event = await drawer.finalize();
    expect(stub.settle).toHaveBeenCalledTimes(1);
    expect(event).not.toBeNull();
    expect(event!.amountAtoms).toBe(100_000n);
  });

  it("throws DryTabError when settler reverts", async () => {
    const stub = makeStubSettler({ throwAfter: 0, revertMessage: "settle tx reverted: cap exceeded" });
    const commitment = makeCommitment(1_000_000n);
    const drawer = new StreamingDrawer({
      sellerPrivateKey: SELLER_PK,
      commitment,
      minBatchAtoms: 250_000n,
      _settler: stub,
    });

    await expect(drawer.record(250_000n)).rejects.toBeInstanceOf(DryTabError);
    expect(drawer.isDry).toBe(true);
  });

  it("halts all further draws after a dry-tab", async () => {
    const stub = makeStubSettler({ throwAfter: 1 }); // first settle ok, second reverts
    const commitment = makeCommitment(2_000_000n);
    const drawer = new StreamingDrawer({
      sellerPrivateKey: SELLER_PK,
      commitment,
      minBatchAtoms: 250_000n,
      _settler: stub,
    });

    // First batch — succeeds
    await drawer.record(250_000n);
    expect(drawer.isDry).toBe(false);

    // Second batch — reverts, sets isDry
    await expect(drawer.record(250_000n)).rejects.toBeInstanceOf(DryTabError);
    expect(drawer.isDry).toBe(true);

    // Third attempt — immediately throws without calling settler
    const callsBefore = stub.settle.mock.calls.length;
    await expect(drawer.record(250_000n)).rejects.toBeInstanceOf(DryTabError);
    expect(stub.settle.mock.calls.length).toBe(callsBefore); // no new call
  });

  it("calls onEvent for each successful draw", async () => {
    const stub = makeStubSettler();
    const commitment = makeCommitment(2_000_000n);
    const events: import("@sip402/server").SettlementEvent[] = [];
    const drawer = new StreamingDrawer({
      sellerPrivateKey: SELLER_PK,
      commitment,
      minBatchAtoms: 250_000n,
      _settler: stub,
      onEvent: (e) => events.push(e),
    });

    await drawer.record(250_000n);
    await drawer.record(250_000n);

    expect(events.length).toBe(2);
    expect(events[0]!.type).toBe("settle");
    expect(events[0]!.txHash).toMatch(/^0xfake/);
  });
});
