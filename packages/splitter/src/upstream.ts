/**
 * upstream.ts — pluggable AI source for the splitter gateway.
 *
 * Two implementations behind one interface:
 *
 *   veniceUpstream(privateKey)  — real Venice AI via venice-x402-client (MAINNET only).
 *                                  Venice x402 offers eip155:8453 + Solana; no testnet.
 *                                  Swap in tomorrow with a one-line change.
 *
 *   localUpstream()             — deterministic token generator for testnet dev / proof.
 *                                  Emits a canned response a few tokens at a time so
 *                                  the payment loop + on-chain draws are fully exercised
 *                                  without touching Venice.
 *
 * Swapping local → Venice is a one-line change at gateway startup:
 *   const up = IS_MAINNET ? veniceUpstream(PRIVATE_KEY) : localUpstream();
 */

// ---------------------------------------------------------------------------
// Upstream interface
// ---------------------------------------------------------------------------

export interface UpstreamChunk {
  text: string;
  /** Token count for this chunk (used for cost metering). */
  tokens: number;
}

export interface UpstreamRequest {
  model: string;
  messages: { role: string; content: string }[];
}

export interface Upstream {
  /**
   * Stream text tokens for a chat request.
   * Yields {text, tokens} chunks until the response is exhausted.
   */
  chatStream(req: UpstreamRequest): AsyncIterable<UpstreamChunk>;
}

// ---------------------------------------------------------------------------
// veniceUpstream — real Venice AI (MAINNET only)
// ---------------------------------------------------------------------------

/**
 * Wraps venice-x402-client's chatStream to produce {text, tokens} chunks.
 * Venice x402 is Base mainnet + Solana only — do NOT use on Base Sepolia.
 *
 * Usage (mainnet):
 *   const up = veniceUpstream(process.env.PRIVATE_KEY);
 */
export function veniceUpstream(privateKey: string): Upstream {
  return {
    async *chatStream(req: UpstreamRequest): AsyncIterable<UpstreamChunk> {
      // Lazy import so the module doesn't blow up on testnet (no venice funds needed)
      const { VeniceClient } = await import("venice-x402-client");
      const client = new VeniceClient(privateKey, {
        autoTopUp: { enabled: false, amount: 0 },
      });

      // venice-x402-client's chatStream returns AsyncGenerator<string> —
      // each yielded value is a raw delta string (partial token text).
      const stream = client.chatStream({
        model: req.model,
        messages: req.messages as { role: "system" | "user" | "assistant"; content: string }[],
      });

      for await (const deltaText of stream) {
        // The SDK yields raw delta strings; estimate tokens from char count.
        const text = typeof deltaText === "string" ? deltaText : String(deltaText);
        if (!text) continue;
        const tokens = Math.ceil(text.length / 4) || 1;
        yield { text, tokens };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// localUpstream — deterministic token generator (testnet / dev / demo)
// ---------------------------------------------------------------------------

/**
 * A deterministic multi-sentence response emitted a few tokens at a time.
 * Designed so that with USDC_PER_1K_TOKENS = 2000n and minBatch = $0.25,
 * approximately 125k tokens are needed per batch — but we make the response
 * long enough and the chunk size small enough to cross multiple batch thresholds
 * during a single stream, exercising the incremental draw loop.
 *
 * For the proof script specifically, we emit enough tokens to exhaust a $1 cap
 * with $0.25 batches (~4 draws), then a few more to trigger the dry-tab revert.
 */
export function localUpstream(): Upstream {
  // A moderately long response (~300 words) repeated to generate enough token volume.
  const CANNED_RESPONSE = `The sip402 protocol implements a capital-backed x402 batch-settlement binding using ERC-7710 delegations on Base. Rather than settling per request, a buyer opens a periodic session by granting a bounded spending delegation from their smart account treasury to an agent key. When the agent needs to pay for a resource, it creates a commitment — a redelegation to the specific seller — scoped to the request amount. The seller accumulates these commitments and redeems them in batches through the MetaMask Delegation Manager, drawing USDC atomically from the treasury.

The ERC20PeriodTransferEnforcer enforces the cumulative spending ceiling on-chain: each redemption call checks that the running total for the current period does not exceed the delegation's periodAmount caveat. An over-cap redemption reverts atomically — no partial settlement, no intermediary trust required. The buyer can revoke the root delegation at any time; subsequent redemptions immediately revert.

This streaming gateway implements the seller side: it resells Venice AI inference, billing the buyer per token by driving incremental on-chain draws as tokens are delivered. Each batch of tokens whose cost reaches the minBatchAtoms threshold triggers a redeemDelegations transaction against the buyer's commitment. The USDC flows from the buyer's treasury to the seller EOA in real time, with each draw producing a verifiable on-chain transaction hash — a live USDC ticker in the truest sense.

On testnet today the upstream is a local deterministic generator exercising the full payment loop with real Base Sepolia transactions. On mainnet tomorrow, swapping localUpstream for veniceUpstream is a one-line change, replacing the canned response with live Venice inference billed through real USDC on Base mainnet.`;

  // Repeat enough to generate ~500 tokens total (well over the $1 cap at $0.002/1k)
  // Actually at $0.002/1k, $1 = 500k tokens. We need to make the price higher or
  // generate lots of tokens. The pricing is configured in pricing.ts.
  // With USDC_PER_1K_TOKENS = 2000n ($0.002/k atoms = $0.000002/k tokens),
  // actually $0.002 per 1k tokens in USDC atoms means 2000 atoms per 1000 tokens.
  // To reach $0.25 (250_000 atoms) we need: 250_000 / 2000 * 1000 = 125_000 tokens per batch.
  // That's a lot for a canned response. So the proof script uses a much higher price constant.
  // The localUpstream emits word-by-word to be realistic; the proof uses pricing.ts PRICE constant.
  const WORDS = CANNED_RESPONSE.split(" ");
  const CHUNK_SIZE = 3; // words per chunk

  return {
    async *chatStream(_req: UpstreamRequest): AsyncIterable<UpstreamChunk> {
      for (let i = 0; i < WORDS.length; i += CHUNK_SIZE) {
        const slice = WORDS.slice(i, i + CHUNK_SIZE);
        const text = (i === 0 ? "" : " ") + slice.join(" ");
        // ~1 token per 4 chars (GPT tokenizer rule of thumb)
        const tokens = Math.ceil(text.length / 4);
        yield { text, tokens };
        // Small async yield so the stream feels real and allows interleaving
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}
