/**
 * events.ts — settlement event feed for the dashboard.
 *
 *   - SettlementBus: a tiny in-process pub/sub the accumulator emits into
 *     (wire accumulator's onEvent to bus.publish).
 *   - sseHandler(bus): a Hono handler streaming SettlementEvents as
 *     text/event-stream to the dashboard.
 *   - webhookHandler(): a Hono handler for POST /webhook/1shot that records the
 *     1Shot relayer's terminal status (mainnet). On testnet it's unused but
 *     present, so the same server shape works on both networks.
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import type { SettlementEvent } from "./accumulator.js";

type Listener = (e: SettlementEvent) => void;

export class SettlementBus {
  readonly #listeners = new Set<Listener>();
  readonly #history: SettlementEvent[] = [];
  readonly #maxHistory: number;

  constructor(opts: { maxHistory?: number } = {}) {
    this.#maxHistory = opts.maxHistory ?? 200;
  }

  publish(e: SettlementEvent): void {
    this.#history.push(e);
    if (this.#history.length > this.#maxHistory) this.#history.shift();
    for (const l of this.#listeners) l(e);
  }

  subscribe(l: Listener): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }

  history(): readonly SettlementEvent[] {
    return this.#history;
  }
}

function serializeEvent(e: SettlementEvent): string {
  return JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}

/**
 * Hono handler streaming SettlementEvents over SSE. Replays history on connect,
 * then live-streams new events until the client disconnects.
 */
export function sseHandler(bus: SettlementBus) {
  return (c: Context) =>
    streamSSE(c, async (stream) => {
      for (const e of bus.history()) {
        await stream.writeSSE({ event: e.type, data: serializeEvent(e) });
      }

      let resolveClose: () => void;
      const closed = new Promise<void>((r) => {
        resolveClose = r;
      });

      const queue: SettlementEvent[] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe((e) => {
        queue.push(e);
        wake?.();
      });

      stream.onAbort(() => {
        unsubscribe();
        resolveClose();
      });

      try {
        while (true) {
          while (queue.length > 0) {
            const e = queue.shift()!;
            await stream.writeSSE({ event: e.type, data: serializeEvent(e) });
          }
          const next = new Promise<void>((r) => {
            wake = r;
          });
          await Promise.race([next, closed]);
          // a small keepalive comment so proxies don't time the stream out
          await stream.writeSSE({ data: "", event: "ping" });
        }
      } finally {
        unsubscribe();
      }
    });
}

export interface OneShotWebhookPayload {
  taskId?: string;
  status?: string;
  transactionHash?: string;
  [k: string]: unknown;
}

export type OneShotStatusListener = (payload: OneShotWebhookPayload) => void;

/**
 * Hono handler for POST /webhook/1shot — records the relayer's terminal status
 * (mainnet). Returns 200 and invokes the optional onStatus callback.
 */
export function webhookHandler(onStatus?: OneShotStatusListener) {
  return async (c: Context) => {
    let payload: OneShotWebhookPayload;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON" }, 400);
    }
    onStatus?.(payload);
    return c.json({ ok: true });
  };
}
