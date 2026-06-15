// ── lib/bus.ts — in-process event bus feeding the SSE stream ──────────────────
// A tiny pub/sub fan-out. API routes call pushEvent(); the /api/events SSE route
// subscribes and forwards each event to the browser. This is the SERVER side of
// the event contract — page.tsx decodes exactly these shapes:
//   • settlement   — a confirmed (or reverted) on-chain settlement → ticker/receipts
//   • agent_text   — a streamed delivery chunk → the agent's console panel
//   • status       — a human-readable log line ("Cascade complete" ends the run)
//   • tree_update  — the delegation tree opened/changed
// `agent` scopes the event to the active delivery lane: "writer" on testnet,
// "researcher" on mainnet (a single agent either way).

export interface BusEvent {
  type: "settlement" | "agent_text" | "status" | "tree_update";
  agent?: "writer" | "researcher";
  payload: unknown;
}

type Listener = (e: BusEvent) => void;

// Held on globalThis so the SSE route (/api/events) and the routes that call
// pushEvent (/api/run, /api/open, …) share ONE listener set even when Next's dev
// server compiles them into separate module instances. A plain module-scoped Set
// would be duplicated per route in dev, so settlement events would never reach the
// browser's EventSource and the live ticker/receipts would stay frozen.
const g = globalThis as typeof globalThis & { __sip402Bus?: Set<Listener> };
const listeners: Set<Listener> = (g.__sip402Bus ??= new Set<Listener>());

// Fan a single event out to every live SSE subscriber. A throwing listener
// (e.g. a browser that disconnected mid-enqueue) is skipped, not fatal.
export function pushEvent(e: BusEvent) {
  for (const l of listeners) {
    try { l(e); } catch { /* ignore disconnected subscribers */ }
  }
}

// Register an SSE connection; returns an unsubscribe to drop it on disconnect.
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
