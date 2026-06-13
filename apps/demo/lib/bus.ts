export interface BusEvent {
  type: "settlement" | "agent_text" | "status" | "tree_update";
  agent?: "writer" | "illustrator";
  payload: unknown;
}

type Listener = (e: BusEvent) => void;

const listeners = new Set<Listener>();

export function pushEvent(e: BusEvent) {
  for (const l of listeners) {
    try { l(e); } catch { /* ignore disconnected subscribers */ }
  }
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
