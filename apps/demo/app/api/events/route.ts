export const runtime = "nodejs";

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
