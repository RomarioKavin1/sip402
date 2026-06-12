/**
 * gateway.ts — OpenAI-compatible Hono HTTP gateway for @sip402/splitter.
 *
 * POST /v1/chat/completions
 *   - Reads the buyer's commitment from the x-sip-commitment header (base64 JSON).
 *   - Opens a StreamingDrawer over the commitment.
 *   - Streams the Upstream tokens to the client (text/event-stream, SSE).
 *   - Per token batch drives drawer.record(tokenCostAtoms(tokens)).
 *   - If a draw reverts (dry-tab), ends the stream with [DONE - session dry].
 *
 * GET /events
 *   - SSE feed of SettlementEvents for a dashboard (replay + live).
 *
 * Factory: makeGateway({ sellerPrivateKey, upstream }) → Hono app.
 */

import { Hono } from "hono";
import { streamText } from "hono/streaming";

import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { DEFAULT_RPC_URL } from "@sip402/core";
import { SettlementBus, sseHandler } from "@sip402/server";

import type { Upstream, UpstreamRequest } from "./upstream.js";
import { tokenCostAtoms } from "./pricing.js";
import { StreamingDrawer, DryTabError } from "./streamingDrawer.js";
import type { Commitment } from "@sip402/client";

// ---------------------------------------------------------------------------
// Header name for the buyer's commitment
// ---------------------------------------------------------------------------

/** Primary header — x402 style PAYMENT-SIGNATURE convention. */
export const COMMITMENT_HEADER = "PAYMENT-SIGNATURE";
/** Alias header that's less surprising for REST callers. */
export const COMMITMENT_HEADER_ALT = "x-sip-commitment";

// ---------------------------------------------------------------------------
// makeGateway factory
// ---------------------------------------------------------------------------

export interface GatewayOpts {
  /** Seller EOA private key. Draws are sent as txns from this account. */
  sellerPrivateKey: Hex;
  /** AI upstream to use. Swap localUpstream() for veniceUpstream() on mainnet. */
  upstream: Upstream;
  /** Minimum USDC atoms before an on-chain draw is triggered. Default $0.25. */
  minBatchAtoms?: bigint;
  /** RPC URL override (defaults to DEFAULT_RPC_URL). */
  rpcUrl?: string;
}

/**
 * Build and return the Hono gateway app.
 *
 * Exports:
 *   app        — the Hono instance (mount or serve directly)
 *   bus        — the SettlementBus (subscribe for dashboard events)
 *   sellerAddress — the seller's EOA address (derived from sellerPrivateKey)
 */
export function makeGateway(opts: GatewayOpts): {
  app: Hono;
  bus: SettlementBus;
  sellerAddress: string;
} {
  const {
    sellerPrivateKey,
    upstream,
    minBatchAtoms = 250_000n, // $0.25 USDC
    rpcUrl = DEFAULT_RPC_URL,
  } = opts;

  const sellerAddress = privateKeyToAccount(sellerPrivateKey).address;
  const bus = new SettlementBus({ maxHistory: 200 });

  const app = new Hono();

  // ── POST /v1/chat/completions ────────────────────────────────────────────

  app.post("/v1/chat/completions", async (c) => {
    // 1. Read commitment from header
    const rawHeader =
      c.req.header(COMMITMENT_HEADER) ?? c.req.header(COMMITMENT_HEADER_ALT);

    if (!rawHeader) {
      return c.json(
        {
          error: {
            message: `Missing commitment header. Include the buyer's commitment as ${COMMITMENT_HEADER} or ${COMMITMENT_HEADER_ALT} (base64-JSON encoded Commitment).`,
            type: "payment_required",
          },
        },
        402,
      );
    }

    let commitment: Commitment;
    try {
      const decoded = Buffer.from(rawHeader, "base64").toString("utf8");
      commitment = JSON.parse(decoded) as Commitment;
      if (!commitment?.permissionContext || !commitment?.amount) {
        throw new Error("missing permissionContext or amount");
      }
    } catch (err) {
      return c.json(
        {
          error: {
            message: `Malformed commitment header: ${err instanceof Error ? err.message : String(err)}`,
            type: "invalid_request_error",
          },
        },
        400,
      );
    }

    // 2. Parse the chat request body
    let body: UpstreamRequest;
    try {
      body = (await c.req.json()) as UpstreamRequest;
      if (!body?.messages || !Array.isArray(body.messages)) {
        throw new Error("missing messages array");
      }
    } catch (err) {
      return c.json(
        {
          error: {
            message: `Invalid request body: ${err instanceof Error ? err.message : String(err)}`,
            type: "invalid_request_error",
          },
        },
        400,
      );
    }

    // 3. Open the StreamingDrawer
    const drawer = new StreamingDrawer({
      sellerPrivateKey,
      commitment,
      minBatchAtoms,
      rpcUrl,
      onEvent: (e) => bus.publish(e),
    });

    // 4. Stream tokens with per-batch draws (SSE text/event-stream)
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");

    return streamText(c, async (stream) => {
      let dryTab = false;

      try {
        for await (const chunk of upstream.chatStream(body)) {
          if (dryTab) break;

          // Write the token to the stream as an SSE data line (OpenAI format)
          const sseData = JSON.stringify({
            choices: [{ delta: { content: chunk.text }, finish_reason: null }],
          });
          await stream.write(`data: ${sseData}\n\n`);

          // Meter the cost and maybe draw on-chain
          try {
            const costAtoms = tokenCostAtoms(chunk.tokens);
            await drawer.record(costAtoms);
          } catch (err) {
            if (err instanceof DryTabError) {
              dryTab = true;
              await stream.write(`data: [DONE - session dry]\n\n`);
              break;
            }
            // Other errors: surface and stop
            await stream.write(
              `data: [ERROR: ${err instanceof Error ? err.message : String(err)}]\n\n`,
            );
            break;
          }
        }

        if (!dryTab) {
          // Finalize: flush any remaining accrued cost
          try {
            await drawer.finalize();
          } catch (err) {
            if (!(err instanceof DryTabError)) {
              await stream.write(
                `data: [ERROR finalizing: ${err instanceof Error ? err.message : String(err)}]\n\n`,
              );
            }
          }
          await stream.write(`data: [DONE]\n\n`);
        }
      } catch (outerErr) {
        await stream.write(
          `data: [FATAL: ${outerErr instanceof Error ? outerErr.message : String(outerErr)}]\n\n`,
        );
      }
    });
  });

  // ── GET /events — SSE settlement feed ────────────────────────────────────
  app.get("/events", sseHandler(bus));

  // ── GET /health ───────────────────────────────────────────────────────────
  app.get("/health", (c) =>
    c.json({ ok: true, seller: sellerAddress, minBatchAtoms: minBatchAtoms.toString() }),
  );

  return { app, bus, sellerAddress };
}
