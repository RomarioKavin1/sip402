"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface SettlementEntry {
  agent: "writer" | "illustrator" | "researcher";
  amountAtoms: bigint;
  txHash?: string;
  at: number;
}

interface DemoData {
  treasury: string;
  agent: string;
  capUsd: number;
  sellerAddress: string;
  network?: string;
  budgetUsd?: number;
  // Testnet MetaMask grant flow
  sessionAddress?: string;
}

// Base Sepolia
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_HEX = "0x14a34";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// Minimal EIP-1193 provider shape (window.ethereum).
interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
}
declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

interface AgentState {
  drawn: bigint;
  text: string;
  revoked: boolean;
}

interface NetworkConfig {
  isMainnet: boolean;
  network: string;
  basescanBase: string;
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
  const [researcher, setResearcher] = useState<AgentState>({ drawn: 0n, text: "", revoked: false });
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const [netConfig, setNetConfig] = useState<NetworkConfig>({
    isMainnet: false,
    network: "base-sepolia",
    basescanBase: "https://sepolia.basescan.org/tx",
  });
  const evtSourceRef = useRef<EventSource | null>(null);
  const writerTextRef = useRef<HTMLDivElement>(null);
  const illustratorTextRef = useRef<HTMLDivElement>(null);
  const researcherTextRef = useRef<HTMLDivElement>(null);

  // Ticker animation
  const [tickerGlow, setTickerGlow] = useState(false);
  const [capRevert, setCapRevert] = useState(false);

  const addStatus = useCallback((msg: string) => {
    setStatusLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  // Fetch network config once on mount
  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => setNetConfig(cfg as NetworkConfig))
      .catch(() => {/* use default */});
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
          agent?: "writer" | "illustrator" | "researcher";
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
          if (!entry.txHash) {
            // an over-cap draw reverted on-chain — the chain says no
            setCapRevert(true);
            setTimeout(() => setCapRevert(false), 600);
          }
          if (agent === "writer") {
            setWriter((prev) => ({ ...prev, drawn: prev.drawn + amountAtoms }));
          } else if (agent === "illustrator") {
            setIllustrator((prev) => ({ ...prev, drawn: prev.drawn + amountAtoms }));
          } else if (agent === "researcher") {
            setResearcher((prev) => ({ ...prev, drawn: prev.drawn + amountAtoms }));
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
          } else if (agent === "illustrator") {
            setIllustrator((prev) => ({ ...prev, text: prev.text + text }));
            requestAnimationFrame(() => {
              if (illustratorTextRef.current) {
                illustratorTextRef.current.scrollTop = illustratorTextRef.current.scrollHeight;
              }
            });
          } else if (agent === "researcher") {
            setResearcher((prev) => ({ ...prev, text: prev.text + text }));
            requestAnimationFrame(() => {
              if (researcherTextRef.current) {
                researcherTextRef.current.scrollTop = researcherTextRef.current.scrollHeight;
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
            else if (agent === "illustrator") setIllustrator((prev) => ({ ...prev, revoked: true }));
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
    setGranted(false);
    // Reset agent state on new open
    setWriter({ drawn: 0n, text: "", revoked: false });
    setIllustrator({ drawn: 0n, text: "", revoked: false });
    setResearcher({ drawn: 0n, text: "", revoked: false });
    setReceipts([]);
    setTotalDrawn(0n);
    addStatus("Opening session...");
    try {
      const res = await fetch("/api/open", { method: "POST" });
      const data = await res.json() as DemoData & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "open failed");
      setDemo(data);

      if (data.network === "base") {
        // ── Mainnet: server-side agent, no wallet popup ──
        addStatus(`Mainnet session ready — agent ${shortAddr(data.agent)}`);
        setGranted(true); // mainnet needs no grant; enable Run
        return;
      }

      // ── Testnet: drive MetaMask for a real ERC-7715 permission grant ──
      if (!data.sessionAddress) throw new Error("open did not return a session address");
      addStatus(`Session keypair ready — session ${shortAddr(data.sessionAddress)}`);
      await requestMetaMaskGrant(data.sessionAddress as `0x${string}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  // Drive MetaMask to grant a real ERC-7715 erc20-token-periodic permission
  // (2 USDC/day) to the server's session account, then POST it to /api/grant.
  async function requestMetaMaskGrant(sessionAddress: `0x${string}`) {
    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error("MetaMask not detected — install MetaMask to grant the permission");
    }
    const ethereum = window.ethereum;

    // 1. Connect.
    addStatus("Connecting MetaMask...");
    const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
    const account = accounts?.[0];
    if (!account) throw new Error("no MetaMask account connected");
    addStatus(`Connected ${shortAddr(account)}`);

    // 2. Ensure Base Sepolia (84532).
    const currentChain = (await ethereum.request({ method: "eth_chainId" })) as string;
    if (currentChain?.toLowerCase() !== BASE_SEPOLIA_HEX) {
      addStatus("Switching MetaMask to Base Sepolia...");
      try {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BASE_SEPOLIA_HEX }],
        });
      } catch (switchErr) {
        const code = (switchErr as { code?: number })?.code;
        if (code === 4902) {
          await ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: BASE_SEPOLIA_HEX,
                chainName: "Base Sepolia",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: ["https://sepolia.base.org"],
                blockExplorerUrls: ["https://sepolia.basescan.org"],
              },
            ],
          });
        } else {
          throw switchErr;
        }
      }
    }

    // 3. Build a wallet client with the ERC-7715 provider actions and request the grant.
    addStatus("Requesting ERC-7715 permission (approve in MetaMask)...");
    const { createWalletClient, custom, parseUnits } = await import("viem");
    const { baseSepolia } = await import("viem/chains");
    const { erc7715ProviderActions } = await import("@metamask/smart-accounts-kit/actions");

    const walletClient = createWalletClient({
      account: account as `0x${string}`,
      chain: baseSepolia,
      transport: custom(ethereum),
    }).extend(erc7715ProviderActions());

    const now = Math.floor(Date.now() / 1000);
    const grants = await walletClient.requestExecutionPermissions([
      {
        chainId: BASE_SEPOLIA_CHAIN_ID,
        expiry: now + 7 * 24 * 60 * 60, // 7 days
        to: sessionAddress,
        permission: {
          type: "erc20-token-periodic",
          data: {
            tokenAddress: USDC_BASE_SEPOLIA as `0x${string}`,
            periodAmount: parseUnits("0.3", 6), // 0.30 USDC — small so the cap is hit on-camera
            periodDuration: 86400, // per day
            startTime: now,
            justification: "sip402: let this agent spend up to 0.30 USDC/day",
          },
          isAdjustmentAllowed: true,
        },
      },
    ]);

    const grant = grants?.[0];
    if (!grant || !grant.context) {
      throw new Error("MetaMask returned no permission context");
    }
    addStatus(`Permission granted — context ${(grant.context.length - 2) / 2} bytes`);

    // 4. Persist the granted context server-side as the session ROOT.
    const grantRes = await fetch("/api/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: grant.context,
        from: grant.from,
        delegationManager: grant.delegationManager,
        dependencies: grant.dependencies,
        chainId: BASE_SEPOLIA_CHAIN_ID,
      }),
    });
    const grantData = (await grantRes.json()) as { ok?: boolean; error?: string };
    if (!grantRes.ok || !grantData.ok) {
      throw new Error(grantData.error ?? "failed to store grant");
    }

    setGranted(true);
    addStatus("Permission stored — agent can now spend within the 0.30 USDC/day cap");
  }

  async function handleRun() {
    if (!demo) return;
    setError(null);
    setPhase("running");
    addStatus(netConfig.isMainnet ? "Starting mainnet Venice run..." : "Starting cascade...");
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

  const CAP_ATOMS = netConfig.isMainnet ? 150_000n : 400_000n; // $0.15 mainnet / $0.40 testnet
  const capLabel = netConfig.isMainnet ? "$0.15" : "$0.40";
  const totalCapAtoms = netConfig.isMainnet ? 150_000n : 1_000_000n;
  const totalCapLabel = netConfig.isMainnet ? "$0.15" : "$1.00";
  const networkLabel = netConfig.isMainnet ? "Base mainnet" : "Base Sepolia";

  const basescanTxUrl = (hash: string) => `${netConfig.basescanBase}/${hash}`;

  const capPct = Math.min(100, (Number(totalDrawn) / Number(totalCapAtoms)) * 100);

  // Which of the three beats is live, for the explainer banner + spine.
  const step: 1 | 2 | 3 =
    phase === "idle" || (phase === "open" && !granted)
      ? 1
      : phase === "running" || (writer.revoked || illustrator.revoked)
      ? 3
      : 2;

  const stepCopy: Record<1 | 2 | 3, { tag: string; line: string }> = {
    1: {
      tag: "Grant",
      line: netConfig.isMainnet
        ? "Open a mainnet session. The agent is funded server-side; press Run to begin metered Venice draws."
        : "Press Open tab, then approve ONE ERC-7715 Advanced Permission in MetaMask. That grant caps the agent at 0.30 USDC/day, enforced on-chain.",
    },
    2: {
      tag: "Spend",
      line: "The agent sips USDC against the standing session as the AI stream is delivered. Each draw is a real on-chain settlement; watch the ticker count up toward the cap.",
    },
    3: {
      tag: "Enforce",
      line: "The chain holds the line. An over-cap draw reverts (dry tab); Revoke disables the delegation so the next draw cannot settle. No custodian is asked to stop.",
    },
  };

  const beats: Array<{ n: 1 | 2 | 3; tag: string; sub: string }> = [
    { n: 1, tag: "Grant", sub: "one ERC-7715 permission" },
    { n: 2, tag: "Spend", sub: "agent sips USDC" },
    { n: 3, tag: "Enforce", sub: "chain caps + revokes" },
  ];

  const runLabel = netConfig.isMainnet ? "Run Venice" : "Run cascade";

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-8 sm:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-amber">
            Live demo
          </p>
          <h1 className="mt-1 display-3 font-semibold text-text">
            Grant. Spend. Enforce.
          </h1>
          <p className="mt-1 font-mono text-xs text-text-faint">
            batch-settlement · {networkLabel} · real draws
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border rule px-2.5 py-1 font-mono text-xs text-text-dim">
            {networkLabel}
          </span>
          <button
            onClick={handleOpen}
            disabled={phase !== "idle"}
            className="rounded-md border border-amber bg-amber px-4 py-2 text-sm font-medium text-ink transition-all hover:bg-amber-deep disabled:cursor-not-allowed disabled:border-line disabled:bg-transparent disabled:text-text-faint"
          >
            Open tab
          </button>
          <button
            onClick={handleRun}
            disabled={phase !== "open" || !demo || !granted}
            className="rounded-md border rule px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-ink-3 disabled:cursor-not-allowed disabled:text-text-faint"
          >
            {runLabel}
          </button>
        </div>
      </div>

      {/* Step explainer banner — tells a first-time viewer what's happening now */}
      <div className="mb-6 flex items-start gap-3 rounded-lg border rule bg-ink-2 p-4">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber font-mono text-xs text-amber">
          {step}
        </span>
        <p className="text-sm leading-relaxed text-text-dim">
          <span className="font-medium text-text">{stepCopy[step].tag}.</span>{" "}
          {stepCopy[step].line}
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-revert bg-revert-dim p-3 text-sm text-revert">
          {error}
        </div>
      )}

      {/* MetaMask ERC-7715 grant status (testnet only) */}
      {!netConfig.isMainnet && demo && phase !== "idle" && (
        granted ? (
          <div className="mb-6 flex items-center gap-2 rounded-lg border rule bg-ink-2 p-3 text-sm text-text-dim">
            <span className="text-confirmed">✓</span>
            <span>
              Permission granted via MetaMask — agent may spend up to{" "}
              <span className="font-mono font-medium text-text">0.30 USDC / day</span>
              {demo.sessionAddress && (
                <> · session <span className="font-mono text-text-faint">{shortAddr(demo.sessionAddress)}</span></>
              )}
            </span>
          </div>
        ) : (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-amber bg-amber-glow p-3 text-sm text-amber">
            <span>⏳</span>
            <span>Approve the ERC-7715 Advanced Permission in the MetaMask popup to enable the run.</span>
          </div>
        )
      )}

      {/* The 3-beat spine */}
      <div className="mb-8 grid grid-cols-3 gap-px overflow-hidden rounded-lg border rule">
        {beats.map((b) => {
          const active = b.n === step;
          const done = b.n < step;
          return (
            <div
              key={b.n}
              className={`flex flex-col gap-0.5 bg-ink-2 px-4 py-3 ${
                active ? "bg-ink-3" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-xs ${
                    active ? "text-amber" : done ? "text-confirmed" : "text-text-faint"
                  }`}
                >
                  {String(b.n).padStart(2, "0")}
                </span>
                <span
                  className={`text-sm font-medium ${
                    active ? "text-text" : "text-text-dim"
                  }`}
                >
                  {b.tag}
                </span>
              </div>
              <span className="font-mono text-[11px] text-text-faint">{b.sub}</span>
            </div>
          );
        })}
      </div>

      {/* Ticker — the centerpiece */}
      <section className="mb-8">
        <div className="rounded-lg border rule bg-ink-2 p-6 sm:p-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
                Total drawn · USDC
              </p>
              <div
                className={`mt-2 font-mono text-6xl font-bold tabular-nums tracking-tight transition-all duration-300 sm:text-7xl ${
                  capRevert
                    ? "revert-pulse text-revert"
                    : tickerGlow
                    ? "text-amber"
                    : "text-amber"
                }`}
                style={
                  tickerGlow && !capRevert
                    ? { textShadow: "0 0 24px var(--amber-glow)" }
                    : undefined
                }
              >
                ${atomsToUsd(totalDrawn)}
              </div>
            </div>
            <div className="text-left sm:text-right">
              <p className="font-mono text-xs text-text-faint">cap</p>
              <p className="font-mono text-2xl font-medium tabular-nums text-text-dim">
                {totalCapLabel}
              </p>
            </div>
          </div>

          {/* thin cap rail */}
          <div className="mt-6">
            <div className="h-1 w-full overflow-hidden rounded-full bg-ink-3">
              <div
                className={`h-1 rounded-full transition-all duration-500 ${
                  capRevert ? "bg-revert" : "bg-amber"
                }`}
                style={{ width: `${capPct}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-text-faint">
              <span>{capPct.toFixed(0)}% of cap</span>
              {capRevert && (
                <span className="text-revert">cap reached on-chain · draw reverted</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Session / delegation tree */}
      <section className="mb-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          {netConfig.isMainnet ? "Session" : "Delegation tree"}
        </h2>
        <div className="rounded-lg border rule bg-ink-2 p-5">
          {netConfig.isMainnet ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-amber">◆</span>
                <span className="text-sm text-text">researcher</span>
                {demo && (
                  <span className="font-mono text-xs text-text-faint">{shortAddr(demo.agent)}</span>
                )}
                <span className="ml-auto font-mono text-xs tabular-nums text-text-dim">
                  ${atomsToUsd(researcher.drawn)} <span className="text-text-faint">/ {capLabel}</span>
                </span>
              </div>
              <div className="font-mono text-xs text-text-faint">
                Venice model: llama-3.3-70b · gasless 1Shot draws
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-text-faint">▣</span>
                <span className="text-sm text-text">treasury</span>
                {demo && (
                  <span className="font-mono text-xs text-text-faint">{shortAddr(demo.treasury)}</span>
                )}
                <span className="ml-auto font-mono text-xs tabular-nums text-text-dim">
                  ${atomsToUsd(totalDrawn)} <span className="text-text-faint">/ {totalCapLabel}</span>
                </span>
              </div>
              <div className="ml-4 space-y-3 border-l rule pl-4">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-text-faint">◈</span>
                  <span className="text-sm text-text">orchestrator</span>
                  {demo && (
                    <span className="font-mono text-xs text-text-faint">{shortAddr(demo.agent)}</span>
                  )}
                  <span className="ml-auto font-mono text-xs tabular-nums text-text-dim">
                    cap {totalCapLabel}
                  </span>
                </div>
                <div className="ml-4 space-y-3 border-l rule pl-4">
                  {(["writer", "illustrator"] as const).map((agent) => {
                    const a = agent === "writer" ? writer : illustrator;
                    return (
                      <div key={agent} className="flex items-center gap-3">
                        <span className={`font-mono text-xs ${a.revoked ? "text-revert" : "text-text-faint"}`}>◆</span>
                        <span className={`text-sm ${a.revoked ? "text-revert line-through" : "text-text"}`}>
                          {agent}
                        </span>
                        <span className="ml-auto font-mono text-xs tabular-nums text-text-dim">
                          ${atomsToUsd(a.drawn)} <span className="text-text-faint">/ {capLabel}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Agent panels */}
      <section className="mb-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Delivery
        </h2>
        {netConfig.isMainnet ? (
          <div className="rounded-lg border rule bg-ink-2 p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-text">researcher</h3>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1 w-32 rounded-full bg-ink-3">
                    <div
                      className="h-1 rounded-full bg-amber transition-all duration-500"
                      style={{ width: `${Math.min(100, CAP_ATOMS > 0n ? Number((researcher.drawn * 100n) / CAP_ATOMS) : 0)}%` }}
                    />
                  </div>
                  <span className="font-mono text-xs tabular-nums text-text-faint">
                    ${atomsToUsd(researcher.drawn)} / {capLabel}
                  </span>
                </div>
              </div>
              <span className="rounded border rule px-2 py-0.5 font-mono text-xs text-text-dim">
                llama-3.3-70b
              </span>
            </div>
            <div
              ref={researcherTextRef}
              className="ledger-scroll h-40 overflow-y-auto rounded-md bg-ink p-3 font-mono text-xs leading-relaxed text-text-dim"
            >
              {researcher.text || (
                <span className="text-text-faint">
                  {phase === "running" ? "Streaming Venice inference..." : "No output yet"}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {(["writer", "illustrator"] as const).map((agent) => {
              const a = agent === "writer" ? writer : illustrator;
              const pct = CAP_ATOMS > 0n ? Number((a.drawn * 100n) / CAP_ATOMS) : 0;
              return (
                <div
                  key={agent}
                  className={`rounded-lg border bg-ink-2 p-5 ${
                    a.revoked ? "border-revert" : "rule"
                  }`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium capitalize text-text">{agent}</h3>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="h-1 w-32 rounded-full bg-ink-3">
                          <div
                            className={`h-1 rounded-full transition-all duration-500 ${a.revoked ? "bg-revert" : "bg-amber"}`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs tabular-nums text-text-faint">
                          ${atomsToUsd(a.drawn)} / {capLabel}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevoke(agent)}
                      disabled={a.revoked || phase === "idle" || phase === "open"}
                      className="rounded-md border border-revert px-3 py-1.5 text-xs text-revert transition-colors hover:bg-revert-dim disabled:cursor-not-allowed disabled:border-line disabled:text-text-faint"
                    >
                      {a.revoked ? "Revoked" : "Revoke"}
                    </button>
                  </div>
                  <div
                    ref={agent === "writer" ? writerTextRef : illustratorTextRef}
                    className="ledger-scroll h-32 overflow-y-auto rounded-md bg-ink p-3 font-mono text-xs leading-relaxed text-text-dim"
                  >
                    {a.text || (
                      <span className="text-text-faint">
                        {phase === "running" ? "Waiting for tokens..." : "No output yet"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Receipt feed */}
      <section className="mb-8">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Receipt feed
        </h2>
        <div className="rounded-lg border rule bg-ink-2 p-5">
          {receipts.length === 0 ? (
            <p className="font-mono text-xs text-text-faint">No settlements yet</p>
          ) : (
            <div className="ledger-scroll max-h-56 space-y-1 overflow-y-auto">
              {receipts.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-line-soft py-1.5 font-mono text-xs last:border-0"
                >
                  <span className="shrink-0 tabular-nums text-text-faint">
                    {new Date(r.at).toLocaleTimeString()}
                  </span>
                  <span className="shrink-0 text-text-dim">{r.agent}</span>
                  <span className="shrink-0 tabular-nums text-amber">${atomsToUsd(r.amountAtoms)}</span>
                  <span className="text-text-faint">·</span>
                  {r.txHash ? (
                    <a
                      href={basescanTxUrl(r.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 truncate text-text-dim underline-offset-2 transition-colors hover:text-text hover:underline"
                    >
                      <span className="text-confirmed">✓</span>
                      {shortAddr(r.txHash)} ↗
                    </a>
                  ) : (
                    <span className="text-revert">reverted · cap reached on-chain</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Status log */}
      <section className="mb-4">
        <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.18em] text-text-faint">
          Status
        </h2>
        <div className="rounded-lg border rule bg-ink-2 p-5">
          <div className="ledger-scroll max-h-32 space-y-1 overflow-y-auto">
            {statusLog.length === 0 ? (
              <p className="font-mono text-xs text-text-faint">Ready. Press Open tab to start.</p>
            ) : (
              statusLog.map((s, idx) => (
                <p key={idx} className="font-mono text-xs text-text-dim">{s}</p>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
