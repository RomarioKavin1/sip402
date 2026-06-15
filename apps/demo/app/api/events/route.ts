export const runtime = "nodejs";

// ── /api/events — Server-Sent Events stream (the ticker/receipts/console feed) ─
// The single SSE endpoint the page subscribes to. Every BusEvent pushed by the
// API routes (settlement / agent_text / status / tree_update) is serialized as
// one `data: {json}\n\n` SSE frame here and decoded by page.tsx's onmessage.
// This is the server→client event contract — both sides agree on BusEvent shape.

import { subscribe } from "../../../lib/bus";
import type { BusEvent } from "../../../lib/bus";

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send an initial ping so the browser sees the connection immediately.
      controller.enqueue(encoder.encode("data: {\"type\":\"ping\"}\n\n"));

      const unsub = subscribe((e: BusEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          unsub();
        }
      });

      // Clean up on disconnect — ReadableStream cancel is triggered by the client.
    },
    cancel() {
      // subscriber cleanup happens automatically via the try/catch above
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
