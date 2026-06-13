"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface SettlementEntry {
  agent: "writer" | "illustrator";
  amountAtoms: bigint;
  txHash?: string;
  at: number;
}

interface DemoData {
  treasury: string;
  agent: string;
  capUsd: number;
  sellerAddress: string;
}

interface AgentState {
  drawn: bigint;
  text: string;
  revoked: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function atomsToUsd(atoms: bigint): string {
  const cents = Number(atoms) / 1_000_000;
  return cents.toFixed(6);
}

function shortAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [phase, setPhase] = useState<"idle" | "open" | "running" | "done">("idle");
  const [demo, setDemo] = useState<DemoData | null>(null);
  const [receipts, setReceipts] = useState<SettlementEntry[]>([]);
  const [totalDrawn, setTotalDrawn] = useState<bigint>(0n);
  const [writer, setWriter] = useState<AgentState>({ drawn: 0n, text: "", revoked: false });
  const [illustrator, setIllustrator] = useState<AgentState>({ drawn: 0n, text: "", revoked: false });
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const evtSourceRef = useRef<EventSource | null>(null);
  const writerTextRef = useRef<HTMLDivElement>(null);
  const illustratorTextRef = useRef<HTMLDivElement>(null);

  // Ticker animation
  const [tickerGlow, setTickerGlow] = useState(false);

  const addStatus = useCallback((msg: string) => {
    setStatusLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  // ── SSE listener ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "idle") return;

    const es = new EventSource("/api/events");
    evtSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as {
          type: string;
          agent?: "writer" | "illustrator";
          payload?: Record<string, unknown>;
        };
        if (evt.type === "ping") return;

        if (evt.type === "settlement" && evt.agent) {
          const agent = evt.agent;
          const amountAtoms = BigInt((evt.payload?.amountAtoms as string) ?? "0");
          const entry: SettlementEntry = {
            agent,
            amountAtoms,
            txHash: evt.payload?.txHash as string | undefined,
            at: (evt.payload?.at as number) ?? Date.now(),
          };
          setReceipts((prev) => [entry, ...prev].slice(0, 50));
          setTotalDrawn((prev) => prev + amountAtoms);
          setTickerGlow(true);
          setTimeout(() => setTickerGlow(false), 600);
          if (agent === "writer") {
            setWriter((prev) => ({ ...prev, drawn: prev.drawn + amountAtoms }));
          } else {
            setIllustrator((prev) => ({ ...prev, drawn: prev.drawn + amountAtoms }));
          }
        }

        if (evt.type === "agent_text" && evt.agent) {
          const agent = evt.agent;
          const text = (evt.payload?.text as string) ?? "";
          if (agent === "writer") {
            setWriter((prev) => ({ ...prev, text: prev.text + text }));
            requestAnimationFrame(() => {
              if (writerTextRef.current) {
                writerTextRef.current.scrollTop = writerTextRef.current.scrollHeight;
              }
            });
          } else {
            setIllustrator((prev) => ({ ...prev, text: prev.text + text }));
            requestAnimationFrame(() => {
              if (illustratorTextRef.current) {
                illustratorTextRef.current.scrollTop = illustratorTextRef.current.scrollHeight;
              }
            });
          }
        }

        if (evt.type === "status") {
          const msg = (evt.payload?.msg as string) ?? JSON.stringify(evt.payload);
          addStatus(msg);
          if (msg === "Cascade complete") {
            setPhase("done");
          }
          if (evt.agent && msg.includes("revoked")) {
            const agent = evt.agent;
            if (agent === "writer") setWriter((prev) => ({ ...prev, revoked: true }));
            else setIllustrator((prev) => ({ ...prev, revoked: true }));
          }
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      if (phase === "done") es.close();
    };

    return () => {
      es.close();
      evtSourceRef.current = null;
    };
  }, [phase, addStatus]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleOpen() {
    setError(null);
    setPhase("open");
    addStatus("Opening session...");
    try {
      const res = await fetch("/api/open", { method: "POST" });
      const data = await res.json() as DemoData & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "open failed");
      setDemo(data);
      addStatus(`Session opened — treasury ${shortAddr(data.treasury)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  async function handleRun() {
    if (!demo) return;
    setError(null);
    setPhase("running");
    addStatus("Starting cascade...");
    try {
      const res = await fetch("/api/run", { method: "POST" });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? "run failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("done");
    }
  }

  async function handleRevoke(agent: "writer" | "illustrator") {
    addStatus(`Revoking ${agent}...`);
    try {
      const res = await fetch("/api/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent }),
      });
      const data = await res.json() as { ok?: boolean; txHash?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "revoke failed");
      addStatus(`${agent} revoked — tx ${data.txHash ?? "unknown"}`);
    } catch (err) {
      addStatus(`revoke error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const CAP_ATOMS = 400_000n; // $0.40 per agent

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-slate-200 p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            sip402 <span className="text-indigo-400">demo</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">batch-settlement · Base Sepolia · live draws</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleOpen}
            disabled={phase !== "idle"}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            Open tab
          </button>
          <button
            onClick={handleRun}
            disabled={phase !== "open" || !demo}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
          >
            Run cascade
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg bg-red-950 border border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Top row: delegation tree + USDC ticker */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

        {/* Delegation tree */}
        <div className="rounded-xl bg-[#12121a] border border-slate-800 p-5">
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-4">
            Delegation Tree
          </h2>
          <div className="space-y-3">
            {/* Treasury */}
            <div className="flex items-center gap-3">
              <span className="text-slate-500 text-xs">▣</span>
              <div>
                <span className="text-slate-300 text-sm">treasury</span>
                {demo && (
                  <span className="ml-2 text-slate-600 text-xs font-mono">{shortAddr(demo.treasury)}</span>
                )}
              </div>
              <div className="ml-auto">
                <span className="text-xs font-mono text-emerald-400">
                  ${atomsToUsd(totalDrawn)} <span className="text-slate-600">/ $1.00</span>
                </span>
              </div>
            </div>
            {/* Indent */}
            <div className="ml-4 border-l border-slate-800 pl-4 space-y-3">
              {/* Orchestrator */}
              <div className="flex items-center gap-3">
                <span className="text-slate-500 text-xs">◈</span>
                <span className="text-slate-300 text-sm">orchestrator</span>
                {demo && (
                  <span className="ml-2 text-slate-600 text-xs font-mono">{shortAddr(demo.agent)}</span>
                )}
                <div className="ml-auto">
                  <span className="text-xs font-mono text-emerald-400">cap $1.00</span>
                </div>
              </div>
              {/* Agents */}
              <div className="ml-4 border-l border-slate-800 pl-4 space-y-3">
                {(["writer", "illustrator"] as const).map((agent) => {
                  const a = agent === "writer" ? writer : illustrator;
                  return (
                    <div key={agent} className="flex items-center gap-3">
                      <span className={`text-xs ${a.revoked ? "text-red-500" : "text-slate-500"}`}>◆</span>
                      <span className={`text-sm ${a.revoked ? "text-red-400 line-through" : "text-slate-300"}`}>
                        {agent}
                      </span>
                      <div className="ml-auto text-right">
                        <span className="text-xs font-mono text-emerald-400">
                          ${atomsToUsd(a.drawn)} <span className="text-slate-600">/ $0.40</span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* USDC ticker */}
        <div className="rounded-xl bg-[#12121a] border border-slate-800 p-5 flex flex-col items-center justify-center">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
            Total drawn
          </p>
          <div
            className={`text-5xl font-mono font-semibold transition-all duration-300 ${
              tickerGlow ? "text-emerald-300 drop-shadow-[0_0_20px_rgba(52,211,153,0.6)]" : "text-emerald-400"
            }`}
          >
            ${atomsToUsd(totalDrawn)}
          </div>
          <p className="text-xs text-slate-600 mt-2 font-mono">USDC · Base Sepolia</p>
          <div className="mt-4 w-full bg-slate-800 rounded-full h-1.5">
            <div
              className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (Number(totalDrawn) / 1_000_000) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-600 mt-1">of $1.00 cap</p>
        </div>
      </div>

      {/* Agent panels */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {(["writer", "illustrator"] as const).map((agent) => {
          const a = agent === "writer" ? writer : illustrator;
          const pct = CAP_ATOMS > 0n ? Number((a.drawn * 100n) / CAP_ATOMS) : 0;
          return (
            <div
              key={agent}
              className={`rounded-xl bg-[#12121a] border p-5 ${
                a.revoked ? "border-red-900" : "border-slate-800"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-medium text-slate-200 capitalize">{agent}</h3>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="bg-slate-800 rounded-full h-1 w-32">
                      <div
                        className="bg-indigo-500 h-1 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono text-slate-500">
                      ${atomsToUsd(a.drawn)} / $0.40
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(agent)}
                  disabled={a.revoked || phase === "idle" || phase === "open"}
                  className="px-3 py-1.5 text-xs rounded-lg bg-red-900 hover:bg-red-800 disabled:opacity-40 disabled:cursor-not-allowed border border-red-700 text-red-300 transition-colors"
                >
                  {a.revoked ? "Revoked" : "Revoke"}
                </button>
              </div>
              <div
                ref={agent === "writer" ? writerTextRef : illustratorTextRef}
                className="bg-[#0d0d14] rounded-lg p-3 h-32 overflow-y-auto text-xs text-slate-400 leading-relaxed font-mono"
              >
                {a.text || (
                  <span className="text-slate-700">
                    {phase === "running" ? "Waiting for tokens..." : "No output yet"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Receipt feed */}
      <div className="rounded-xl bg-[#12121a] border border-slate-800 p-5 mb-4">
        <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
          Receipt Feed
        </h2>
        {receipts.length === 0 ? (
          <p className="text-slate-700 text-xs">No settlements yet</p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {receipts.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-3 text-xs font-mono py-1.5 border-b border-slate-800/50 last:border-0"
              >
                <span className="text-slate-600 shrink-0">
                  {new Date(r.at).toLocaleTimeString()}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
                    r.agent === "writer"
                      ? "bg-indigo-950 text-indigo-300"
                      : "bg-purple-950 text-purple-300"
                  }`}
                >
                  {r.agent}
                </span>
                <span className="text-emerald-400 shrink-0">${atomsToUsd(r.amountAtoms)}</span>
                <span className="text-slate-600">·</span>
                {r.txHash ? (
                  <a
                    href={`https://sepolia.basescan.org/tx/${r.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 truncate"
                  >
                    {shortAddr(r.txHash)} ↗
                  </a>
                ) : (
                  <span className="text-red-500">reverted</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status log */}
      <div className="rounded-xl bg-[#12121a] border border-slate-800 p-5">
        <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
          Status
        </h2>
        <div className="max-h-32 overflow-y-auto space-y-1">
          {statusLog.length === 0 ? (
            <p className="text-slate-700 text-xs">Ready. Press Open tab to start.</p>
          ) : (
            statusLog.map((s, i) => (
              <p key={i} className="text-xs text-slate-500 font-mono">{s}</p>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
