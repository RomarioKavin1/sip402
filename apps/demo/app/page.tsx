"use client";

// ── app/page.tsx — the guided Connect → Open → Run → Enforce demo UI ──────────
// Single-page state machine. It drives MetaMask through the on-chain flow
// (connect → grant ONE ERC-7715 0.30 USDC/day permission to the server's
// session key), kicks off the agent run, and renders a live view fed entirely
// by the /api/events SSE stream: a USDC ticker, batch-aware receipts, the
// delegation tree, and per-agent streaming consoles.
//
// State sources:
//   • Local UI / wizard state → React useState below.
//   • Live on-chain progress  → the SSE listener, which mutates ticker /
//     receipts / agent panels as settlement + agent_text + status events arrive.
// The two networks share this UI: testnet shows the MetaMask grant + batch
// settlement; mainnet shows a single "researcher" lane streaming real Venice.

import { useState, useEffect, useRef, useCallback, Fragment } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

interface SettlementEntry {
  agent: "writer" | "researcher";
  amountAtoms: bigint;
  txHash?: string;
  count?: number; // commitments batched into this one tx
  reverted?: boolean; // batch reverted on-chain (cap reached)
  at: number;
}

interface DemoData {
  treasury: string;
  agent: string;
  capUsd: number;
  sellerAddress: string;
  network?: string;
  budgetUsd?: number;
  sessionAddress?: string;
}

// Base Sepolia
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_HEX = "0x14a34";
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// Base mainnet (used by the mainnet BATCH rail — a real ERC-7715 grant on mainnet).
const BASE_MAINNET_CHAIN_ID = 8453;
const BASE_MAINNET_HEX = "0x2105";
const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Per-network chain params for the connect + grant flow. The grant cap is 0.30
// USDC/day on testnet (free) and a smaller 0.15 on mainnet (real money).
type ChainParams = {
  chainId: number;
  chainHex: string;
  usdc: string;
  capUsd: string;
  name: string;
  rpc: string;
  explorer: string;
};
const TESTNET_CHAIN: ChainParams = {
  chainId: BASE_SEPOLIA_CHAIN_ID, chainHex: BASE_SEPOLIA_HEX, usdc: USDC_BASE_SEPOLIA,
  capUsd: "0.3", name: "Base Sepolia", rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org",
};
const MAINNET_CHAIN: ChainParams = {
  chainId: BASE_MAINNET_CHAIN_ID, chainHex: BASE_MAINNET_HEX, usdc: USDC_BASE_MAINNET,
  capUsd: "0.15", name: "Base", rpc: "https://mainnet.base.org", explorer: "https://basescan.org",
};

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
  return (Number(atoms) / 1_000_000).toFixed(6);
}
function shortAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "";
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DemoPage() {
  const [phase, setPhase] = useState<"idle" | "open" | "running" | "done">("idle");
  const [demo, setDemo] = useState<DemoData | null>(null);
  const [receipts, setReceipts] = useState<SettlementEntry[]>([]);
  const [totalDrawn, setTotalDrawn] = useState<bigint>(0n);
  const [writer, setWriter] = useState<AgentState>({ drawn: 0n, text: "", revoked: false });
  const [researcher, setResearcher] = useState<AgentState>({ drawn: 0n, text: "", revoked: false });
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [granted, setGranted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // On mainnet, pick the rail: "venice" (gasless single-draw inference) or "batch"
  // (the full ERC-7715 grant → 1Shot batch → cap-revert, settled gaslessly).
  const [mainnetMode, setMainnetMode] = useState<"venice" | "batch">("venice");
  const [netConfig, setNetConfig] = useState<NetworkConfig>({
    isMainnet: false,
    network: "base-sepolia",
    basescanBase: "https://sepolia.basescan.org/tx",
  });
  const evtSourceRef = useRef<EventSource | null>(null);
  const writerTextRef = useRef<HTMLDivElement>(null);
  const researcherTextRef = useRef<HTMLDivElement>(null);

  const [tickerGlow, setTickerGlow] = useState(false);
  const [capRevert, setCapRevert] = useState(false);

  // Active chain params + whether this run uses the MetaMask ERC-7715 grant flow.
  // Grant flow = always on testnet; on mainnet only for the "batch" rail (the
  // "venice" rail is server-driven and needs no wallet connect/grant).
  const chain = netConfig.isMainnet ? MAINNET_CHAIN : TESTNET_CHAIN;
  const grantFlow = !netConfig.isMainnet || mainnetMode === "batch";

  const addStatus = useCallback((msg: string) => {
    setStatusLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => setNetConfig(cfg as NetworkConfig))
      .catch(() => {/* use default */});
  }, []);

  // ── SSE listener ──────────────────────────────────────────────────────────
  // Opens one EventSource on /api/events for the life of a run and decodes the
  // server's BusEvent frames (see lib/bus.ts for the contract). Each event type
  // updates a different slice of UI state; "Cascade complete" (a status event)
  // is the run-done sentinel that flips phase → "done".

  useEffect(() => {
    if (phase === "idle") return;

    const es = new EventSource("/api/events");
    evtSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data) as {
          type: string;
          agent?: "writer" | "researcher";
          payload?: Record<string, unknown>;
        };
        if (evt.type === "ping") return;

        if (evt.type === "settlement" && evt.agent) {
          const agent = evt.agent;
          const reverted = Boolean(evt.payload?.reverted);
          // amountAtoms = what actually transferred (0 on a revert); attemptedAtoms
          // = what the over-cap batch tried to draw. The receipt shows the attempted
          // figure (so the reverted row reads meaningfully), but the ticker totals
          // below only ever add the actually-settled amount.
          const settledAtoms = BigInt((evt.payload?.amountAtoms as string) ?? "0");
          const attemptedAtoms = evt.payload?.attemptedAtoms
            ? BigInt(evt.payload.attemptedAtoms as string)
            : settledAtoms;
          const count = evt.payload?.count as number | undefined; // commitments in this batch
          const entry: SettlementEntry = {
            agent,
            amountAtoms: reverted ? attemptedAtoms : settledAtoms,
            txHash: evt.payload?.txHash as string | undefined,
            count,
            reverted,
            at: (evt.payload?.at as number) ?? Date.now(),
          };
          setReceipts((prev) => [entry, ...prev].slice(0, 50));
          if (reverted) {
            // Batch reverted atomically on-chain (ERC20PeriodTransferEnforcer hit
            // the cap) — nothing transferred, so add 0 to the ticker; just flash
            // the cap red as the visual "dry tab" signal.
            setCapRevert(true);
            setTimeout(() => setCapRevert(false), 600);
          } else {
            setTotalDrawn((prev) => prev + settledAtoms);
            setTickerGlow(true);
            setTimeout(() => setTickerGlow(false), 600);
            if (agent === "writer") setWriter((p) => ({ ...p, drawn: p.drawn + settledAtoms }));
            else if (agent === "researcher") setResearcher((p) => ({ ...p, drawn: p.drawn + settledAtoms }));
          }
        }

        if (evt.type === "agent_text" && evt.agent) {
          const agent = evt.agent;
          const text = (evt.payload?.text as string) ?? "";
          if (agent === "writer") {
            setWriter((p) => ({ ...p, text: p.text + text }));
            requestAnimationFrame(() => {
              if (writerTextRef.current) writerTextRef.current.scrollTop = writerTextRef.current.scrollHeight;
            });
          } else if (agent === "researcher") {
            setResearcher((p) => ({ ...p, text: p.text + text }));
            requestAnimationFrame(() => {
              if (researcherTextRef.current) researcherTextRef.current.scrollTop = researcherTextRef.current.scrollHeight;
            });
          }
        }

        if (evt.type === "status") {
          const msg = (evt.payload?.msg as string) ?? JSON.stringify(evt.payload);
          addStatus(msg);
          // "Cascade complete" is the agreed end-of-run sentinel (emitted by every
          // run path in /api/run, including error exits) → advance to the "done" UI.
          if (msg === "Cascade complete") setPhase("done");
          if (evt.agent === "writer" && msg.includes("revoked")) {
            setWriter((p) => ({ ...p, revoked: true }));
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

  // Ensure MetaMask is connected and on the active chain (Base Sepolia on testnet,
  // Base mainnet for the mainnet batch rail).
  async function handleConnect() {
    setError(null);
    if (typeof window === "undefined" || !window.ethereum) {
      setError("MetaMask not detected. Install MetaMask (with Advanced Permissions support) to run the demo.");
      return;
    }
    const ethereum = window.ethereum;
    setBusy(true);
    try {
      addStatus("Connecting MetaMask...");
      const accounts = (await ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const acct = accounts?.[0];
      if (!acct) throw new Error("no MetaMask account connected");

      const currentChain = (await ethereum.request({ method: "eth_chainId" })) as string;
      if (currentChain?.toLowerCase() !== chain.chainHex) {
        addStatus(`Switching MetaMask to ${chain.name}...`);
        try {
          await ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: chain.chainHex }],
          });
        } catch (switchErr) {
          if ((switchErr as { code?: number })?.code === 4902) {
            await ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: chain.chainHex,
                  chainName: chain.name,
                  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                  rpcUrls: [chain.rpc],
                  blockExplorerUrls: [chain.explorer],
                },
              ],
            });
          } else throw switchErr;
        }
      }
      setAccount(acct);
      setConnected(true);
      addStatus(`Connected ${shortAddr(acct)} on ${chain.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    setError(null);
    setBusy(true);
    setPhase("open");
    setGranted(false);
    setWriter({ drawn: 0n, text: "", revoked: false });
    setResearcher({ drawn: 0n, text: "", revoked: false });
    setReceipts([]);
    setTotalDrawn(0n);
    addStatus("Opening session...");
    try {
      const res = await fetch("/api/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: netConfig.isMainnet ? mainnetMode : "venice" }),
      });
      const data = (await res.json()) as DemoData & { error?: string; mode?: string };
      if (!res.ok) throw new Error(data.error ?? "open failed");
      setDemo(data);

      // Venice rail (mainnet, no grant): the agent is server-funded; ready to Run.
      if (netConfig.isMainnet && mainnetMode === "venice") {
        addStatus(`Mainnet session ready — agent ${shortAddr(data.agent)}`);
        setGranted(true);
        return;
      }

      // Grant flow (testnet, or the mainnet batch rail): drive the ERC-7715 grant.
      if (!data.sessionAddress) throw new Error("open did not return a session address");
      addStatus(`Session keypair ready — ${shortAddr(data.sessionAddress)}`);
      await requestGrant(data.sessionAddress as `0x${string}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  // Drive MetaMask to grant a real ERC-7715 erc20-token-periodic permission
  // to the server's session account, then POST it to /api/grant.
  async function requestGrant(sessionAddress: `0x${string}`) {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error("MetaMask not detected");
    const acct = account ?? ((await ethereum.request({ method: "eth_requestAccounts" })) as string[])?.[0];
    if (!acct) throw new Error("no MetaMask account connected");

    addStatus("Requesting ERC-7715 permission (approve in MetaMask)...");
    const { createWalletClient, custom, parseUnits } = await import("viem");
    const { base, baseSepolia } = await import("viem/chains");
    const { erc7715ProviderActions } = await import("@metamask/smart-accounts-kit/actions");
    const viemChain = netConfig.isMainnet ? base : baseSepolia;

    const walletClient = createWalletClient({
      account: acct as `0x${string}`,
      chain: viemChain,
      transport: custom(ethereum),
    }).extend(erc7715ProviderActions());

    const now = Math.floor(Date.now() / 1000);
    const grants = await walletClient.requestExecutionPermissions([
      {
        chainId: chain.chainId,
        expiry: now + 7 * 24 * 60 * 60,
        to: sessionAddress,
        permission: {
          type: "erc20-token-periodic",
          data: {
            tokenAddress: chain.usdc as `0x${string}`,
            periodAmount: parseUnits(chain.capUsd, 6),
            periodDuration: 86400,
            startTime: now,
            justification: `sip402: let this agent spend up to ${chain.capUsd} USDC/day`,
          },
          isAdjustmentAllowed: true,
        },
      },
    ]);

    const grant = grants?.[0];
    if (!grant || !grant.context) throw new Error("MetaMask returned no permission context");
    addStatus(`Permission granted — context ${(grant.context.length - 2) / 2} bytes`);

    const grantRes = await fetch("/api/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: grant.context,
        from: grant.from,
        delegationManager: grant.delegationManager,
        dependencies: grant.dependencies,
        chainId: chain.chainId,
      }),
    });
    const grantData = (await grantRes.json()) as { ok?: boolean; error?: string };
    if (!grantRes.ok || !grantData.ok) throw new Error(grantData.error ?? "failed to store grant");

    setGranted(true);
    addStatus(`Permission stored — agent can now spend within the ${chain.capUsd} USDC/day cap`);
  }

  async function handleRun() {
    if (!demo) return;
    setError(null);
    setBusy(true);
    setPhase("running");
    addStatus(!grantFlow ? "Starting mainnet Venice run..." : "Starting cascade...");
    try {
      const res = await fetch("/api/run", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "run failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("done");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    addStatus("Revoking agent — disabling the granted budget...");
    try {
      const res = await fetch("/api/revoke", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "revoke failed");
      addStatus("Agent revoked — no further draws can be redeemed");
    } catch (err) {
      addStatus(`revoke error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  // Testnet cap = the real MetaMask grant (0.30 USDC/day), single agent.
  const CAP_ATOMS = netConfig.isMainnet ? 150_000n : 300_000n;
  const capLabel = netConfig.isMainnet ? "$0.15" : "$0.30";
  const totalCapAtoms = netConfig.isMainnet ? 150_000n : 300_000n;
  const totalCapLabel = netConfig.isMainnet ? "$0.15" : "$0.30";
  const basescanTxUrl = (hash: string) => `${netConfig.basescanBase}/${hash}`;
  const capPct = Math.min(100, (Number(totalDrawn) / Number(totalCapAtoms)) * 100);
  const runLabel = !grantFlow ? "Run Venice" : "Run the agent";

  // Guided wizard: 1 connect · 2 open/grant · 3 run · 4 spend/enforce.
  // Step is DERIVED from real state (not a counter) so it always reflects what
  // the user has actually done:
  //   1 until the wallet connects (testnet only — mainnet has no connect step),
  //   2 until the grant is stored (granted),
  //   3 once granted but still in the "open" phase (ready to Run),
  //   4 once the run has started (running / done = spend & enforce).
  const wizardStep: 1 | 2 | 3 | 4 =
    grantFlow && !connected
      ? 1
      : !granted
      ? 2
      : phase === "open"
      ? 3
      : 4;

  // The grant flow (testnet, or the mainnet batch rail) has a Connect step; the
  // Venice rail is server-driven and starts at Open.
  const steps = grantFlow
    ? [
        { k: "connect", label: "Connect wallet" },
        { k: "open", label: "Open tab" },
        { k: "run", label: "Run" },
        { k: "enforce", label: "Enforce" },
      ]
    : [
        { k: "open", label: "Open session" },
        { k: "run", label: "Run" },
        { k: "enforce", label: "Enforce" },
      ];
  // Map the 1–4 wizardStep onto the steps array. The Venice rail drops the connect
  // step, so its indices shift down by one (offset -2 vs. the grant flow's -1).
  const activeIndex = grantFlow ? wizardStep - 1 : wizardStep - 2;
  const activeKey = steps[Math.max(0, Math.min(activeIndex, steps.length - 1))]?.k;

  // Action-card copy + button for the current step. This is the single guided
  // focus: it resolves activeKey → the heading, explanation, and (optionally) the
  // one button the user should press next. "running" and "done" have distinct
  // copy and no/replay button.
  const action: { tag: string; line: string; button?: { label: string; onClick: () => void; disabled?: boolean } } =
    activeKey === "connect"
      ? {
          tag: "Connect your wallet",
          line: `Connect the MetaMask account you'll grant from. The demo switches it to ${chain.name} for you.`,
          button: { label: busy ? "Connecting…" : "Connect MetaMask", onClick: handleConnect, disabled: busy },
        }
      : activeKey === "open"
      ? {
          tag: !grantFlow ? "Open the session" : "Open a tab",
          line: !grantFlow
            ? "Open a mainnet session. The agent is funded server-side; press to begin metered Venice draws."
            : `Approve ONE ERC-7715 Advanced Permission in MetaMask. It caps the agent at ${chain.capUsd} USDC / day, enforced on-chain${netConfig.isMainnet ? " — settled gaslessly via 1Shot" : ""}.`,
          button: {
            label: busy ? "Waiting for MetaMask…" : !grantFlow ? "Open session" : "Open tab",
            onClick: handleOpen,
            disabled: busy,
          },
        }
      : activeKey === "run"
      ? {
          tag: "Run the agent",
          line: "Permission granted. The agent accumulates commitments and batch-redeems them on-chain, many commitments per transaction, until the cap.",
          button: { label: busy ? "Starting…" : runLabel, onClick: handleRun, disabled: busy },
        }
      : phase === "running"
      ? {
          tag: "The chain is enforcing",
          line: `Commitments are settling in batches, one tx per batch. When a batch crosses the ${totalCapLabel} cap it reverts atomically. Revoke below stops further draws.`,
        }
      : {
          tag: "Session complete",
          line: "The chain held the cap: the over-cap batch reverted atomically. No custodian was ever asked to stop. Run again to replay.",
          button: { label: "Run again", onClick: handleOpen, disabled: busy },
        };

  const showDelivery = phase === "running" || phase === "done";
  const latest = receipts[0];

  return (
    <main className="mx-auto min-h-screen max-w-[1040px] px-5 py-10 sm:px-8">
      {/* title */}
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 font-bold text-[12px] uppercase tracking-[0.04em] text-ink-mute">
          Live demo
        </span>
        <h1 className="mt-3 t-display-lg text-ink">Grant. Spend. Enforce.</h1>
        <p className="mt-2 prose-measure text-[15px] leading-relaxed text-ink-secondary">
          One MetaMask permission opens a metered USDC session. An agent sips
          against it; the chain enforces the cap and your revoke. Follow the four
          steps.
        </p>
      </div>

      {/* stepper */}
      <ol className="mb-8 flex items-center gap-2 sm:gap-3">
        {steps.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <Fragment key={s.k}>
              <li className="flex items-center gap-2.5">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-[13px] ${
                    done
                      ? "bg-primary text-on-primary"
                      : active
                      ? "border-2 border-primary bg-primary-subdued/30 text-primary"
                      : "border border-hairline text-ink-mute"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span
                  className={`hidden text-[14px] sm:inline ${
                    active ? "text-ink" : done ? "text-ink-secondary" : "text-ink-mute"
                  }`}
                >
                  {s.label}
                </span>
              </li>
              {i < steps.length - 1 && (
                <li className={`h-px flex-1 ${done ? "bg-primary" : "bg-hairline"}`} aria-hidden />
              )}
            </Fragment>
          );
        })}
      </ol>

      {/* mainnet rail selector — two real rails (only before a session is opened) */}
      {netConfig.isMainnet && phase === "idle" && (
        <div className="mb-6 flex flex-col gap-2 rounded-2xl border border-hairline bg-canvas-soft p-2 sm:flex-row">
          {([
            { k: "venice", title: "Gasless Venice", sub: "real inference · single draws" },
            { k: "batch", title: "Batch settlement", sub: "grant → 1Shot batch → cap-revert" },
          ] as const).map((m) => {
            const active = mainnetMode === m.k;
            return (
              <button
                key={m.k}
                onClick={() => setMainnetMode(m.k)}
                className={`flex-1 rounded-xl px-4 py-3 text-left transition-colors ${
                  active ? "bg-canvas shadow-e1" : "hover:bg-canvas/60"
                }`}
              >
                <span className={`block text-[14px] ${active ? "text-ink" : "text-ink-secondary"}`}>
                  {m.title}
                </span>
                <span className="block text-[12px] text-ink-mute">{m.sub}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* action card — the guided focus */}
      <div className="mb-6 rounded-2xl border border-hairline bg-canvas p-6 shadow-e1 sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="t-heading-md text-ink">{action.tag}</p>
            <p className="prose-measure mt-1.5 text-[15px] leading-relaxed text-ink-secondary">
              {action.line}
            </p>
            {connected && account && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-pill bg-canvas-soft px-3 py-1 text-[12.5px] text-ink-mute">
                <span className="h-1.5 w-1.5 rounded-pill bg-primary" />
                <span className="font-mono">{shortAddr(account)}</span> · {chain.name}
              </p>
            )}
          </div>
          {action.button && (
            <button
              onClick={action.button.onClick}
              disabled={action.button.disabled}
              className="shrink-0 rounded-pill bg-primary px-6 py-2.5 text-[15px] font-bold text-on-primary transition-colors hover:bg-primary-press disabled:cursor-not-allowed disabled:bg-hairline disabled:text-ink-mute"
            >
              {action.button.label}
            </button>
          )}
        </div>

        {error && (
          <div className="mt-5 rounded-xl border border-ruby/40 bg-ruby/10 p-3 text-[14px] text-ruby">
            {error}
          </div>
        )}
      </div>

      {/* ticker */}
      <div className="mb-6 rounded-2xl border border-hairline bg-canvas p-6 shadow-e1 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-ink-mute">
              Total drawn · USDC
            </p>
            <div
              className={`tnum mt-2 text-6xl font-light sm:text-7xl ${
                capRevert ? "revert-pulse text-ruby" : tickerGlow ? "draw-flash text-primary" : "text-ink"
              }`}
            >
              <span className="text-ink-mute">$</span>
              {atomsToUsd(totalDrawn)}
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.04em] text-ink-mute">cap</p>
            <p className="tnum mt-1 text-2xl font-light text-ink-secondary">{totalCapLabel}</p>
          </div>
        </div>
        <div className="mt-6">
          <div className="h-1.5 w-full overflow-hidden rounded-pill bg-canvas-soft">
            <div
              className={`h-1.5 rounded-pill transition-all duration-500 ${capRevert ? "bg-ruby" : "bg-primary"}`}
              style={{ width: `${capPct}%` }}
            />
          </div>
          <div className="tnum mt-2 flex items-center justify-between text-[12px] text-ink-mute">
            <span>{capPct.toFixed(0)}% of cap</span>
            {latest ? (
              latest.reverted ? (
                <span className="text-ruby">batch reverted · cap reached on-chain</span>
              ) : (
                <span className="flex items-center gap-1.5">
                  latest batch: {latest.count ?? 1} commitments → 1 tx
                  {latest.txHash && (
                    <a
                      href={basescanTxUrl(latest.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      ✓ {shortAddr(latest.txHash)} ↗
                    </a>
                  )}
                </span>
              )
            ) : null}
          </div>
        </div>
      </div>

      {/* delivery — single agent lane; only while/after the agent runs */}
      {/* Picks the active lane by network: mainnet streams the "researcher"
          (real Venice), testnet streams the "writer" (simulated). Revoke is
          testnet-only — mainnet draws are gasless and have no per-agent grant
          to drop. */}
      {showDelivery && (() => {
        const a = netConfig.isMainnet ? researcher : writer;
        const name = !grantFlow ? "researcher" : "agent";
        const textRef = netConfig.isMainnet ? researcherTextRef : writerTextRef;
        const pct = CAP_ATOMS > 0n ? Number((a.drawn * 100n) / CAP_ATOMS) : 0;
        const revoked = grantFlow && writer.revoked;
        const deliveryLabel = !grantFlow
          ? "· real Venice inference"
          : netConfig.isMainnet
          ? "· gasless batch settlement (mainnet)"
          : "· simulated stream (testnet)";
        return (
          <div className="mb-6">
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.04em] text-ink-mute">
              Delivery {deliveryLabel}
            </h2>
            <div
              className={`rounded-2xl border bg-canvas p-5 shadow-e1 ${revoked ? "border-ruby/50" : "border-hairline"}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-[15px] capitalize text-ink">{name}</h3>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 w-28 overflow-hidden rounded-pill bg-canvas-soft">
                      <div
                        className={`h-1.5 rounded-pill transition-all duration-500 ${revoked ? "bg-ruby" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <span className="tnum text-[12.5px] text-ink-mute">
                      ${atomsToUsd(a.drawn)} / {capLabel}
                    </span>
                  </div>
                </div>
                {!grantFlow ? (
                  <span className="rounded-pill border border-hairline px-2.5 py-0.5 font-mono text-[12px] text-ink-mute">
                    llama-3.3-70b
                  </span>
                ) : (
                  <button
                    onClick={handleRevoke}
                    disabled={writer.revoked || phase !== "running"}
                    className="rounded-pill border border-ruby/60 px-3 py-1.5 text-[13px] text-ruby transition-colors hover:bg-ruby/10 disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink-mute"
                  >
                    {writer.revoked ? "Revoked" : "Revoke"}
                  </button>
                )}
              </div>
              <div
                ref={textRef}
                className="panel-scroll h-40 overflow-y-auto rounded-xl bg-navy p-3 font-mono text-[12.5px] leading-relaxed text-canvas/85"
              >
                {a.text || (
                  <span className="text-ink-mute">
                    {phase === "running"
                      ? !grantFlow
                        ? "Streaming Venice inference…"
                        : "Streaming delivery…"
                      : "No output yet"}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* details — hidden by default */}
      <div className="mb-4">
        <button
          onClick={() => setShowDetails((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] text-ink-mute transition-colors hover:text-ink"
        >
          <span className={`inline-block transition-transform ${showDetails ? "rotate-90" : ""}`}>›</span>
          {showDetails ? "Hide details" : "Show details"} · delegation tree, receipts, status log
        </button>

        {showDetails && (
          <div className="mt-4 space-y-6">
            {/* delegation tree */}
            <section>
              <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.04em] text-ink-mute">
                {!grantFlow ? "Session" : "Delegation tree"}
              </h2>
              <div className="rounded-2xl border border-hairline bg-canvas p-5 shadow-e1">
                {!grantFlow ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] text-primary">◆</span>
                      <span className="text-[15px] text-ink">researcher</span>
                      {demo && <span className="font-mono text-[12.5px] text-ink-mute">{shortAddr(demo.agent)}</span>}
                      <span className="tnum ml-auto text-[13px] text-ink-secondary">
                        ${atomsToUsd(researcher.drawn)} <span className="text-ink-mute">/ {capLabel}</span>
                      </span>
                    </div>
                    <div className="font-mono text-[12.5px] text-ink-mute">
                      Venice model: llama-3.3-70b · gasless 1Shot draws
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="text-[12px] text-ink-mute">▣</span>
                      <span className="text-[15px] text-ink">MetaMask grant</span>
                      <span className="rounded-pill bg-primary-subdued/40 px-2 py-0.5 text-[11px] text-primary-deep">
                        {chain.capUsd} USDC / day{netConfig.isMainnet ? " · gasless" : ""}
                      </span>
                      <span className="tnum ml-auto text-[13px] text-ink-secondary">
                        ${atomsToUsd(totalDrawn)} <span className="text-ink-mute">/ {totalCapLabel}</span>
                      </span>
                    </div>
                    <div className="ml-4 space-y-3 border-l border-hairline pl-4">
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] text-primary">◈</span>
                        <span className="text-[15px] text-ink">session key</span>
                        <span className="text-[12.5px] text-ink-mute">delegate</span>
                        {demo?.sessionAddress && (
                          <span className="font-mono text-[12.5px] text-ink-mute">{shortAddr(demo.sessionAddress)}</span>
                        )}
                      </div>
                      <div className="ml-4 space-y-3 border-l border-hairline pl-4">
                        <div className="flex items-center gap-3">
                          <span className={`text-[12px] ${writer.revoked ? "text-ruby" : "text-primary"}`}>◆</span>
                          <span className={`text-[15px] ${writer.revoked ? "text-ruby line-through" : "text-ink"}`}>
                            seller
                          </span>
                          <span className="text-[12.5px] text-ink-mute">redeemer</span>
                          {demo?.sellerAddress && (
                            <span className="font-mono text-[12.5px] text-ink-mute">{shortAddr(demo.sellerAddress)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="pt-1 text-[12.5px] text-ink-mute">
                      {(() => {
                        // Summarize only confirmed batches: count commitments
                        // (count per receipt, default 1) across the settled txs;
                        // reverted batches are excluded since nothing landed.
                        const settled = receipts.filter((r) => !r.reverted && r.txHash);
                        const commits = settled.reduce((n, r) => n + (r.count ?? 1), 0);
                        return settled.length > 0
                          ? `${commits} commitments settled across ${settled.length} batched tx${settled.length > 1 ? "s" : ""}.`
                          : "Commitments batch-redeem here, many per transaction.";
                      })()}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* receipt feed */}
            <section>
              <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.04em] text-ink-mute">
                Receipt feed
              </h2>
              <div className="rounded-2xl border border-hairline bg-canvas p-5 shadow-e1">
                {receipts.length === 0 ? (
                  <p className="text-[13px] text-ink-mute">No settlements yet</p>
                ) : (
                  <div className="panel-scroll max-h-56 space-y-1 overflow-y-auto">
                    {receipts.map((r, i) => (
                      <div
                        key={i}
                        className="tnum flex items-center gap-3 border-b border-hairline py-1.5 font-mono text-[12.5px] last:border-0"
                      >
                        <span className="shrink-0 text-ink-mute">{new Date(r.at).toLocaleTimeString()}</span>
                        <span className="shrink-0 text-ink-secondary">
                          {r.count != null ? "batch" : r.agent}
                        </span>
                        <span className="shrink-0 text-ink">${atomsToUsd(r.amountAtoms)}</span>
                        {r.count != null && (
                          <span className="shrink-0 text-ink-mute">×{r.count}</span>
                        )}
                        <span className="text-ink-mute">·</span>
                        {r.reverted ? (
                          <span className="text-ruby">batch reverted · cap reached on-chain</span>
                        ) : r.txHash ? (
                          <a
                            href={basescanTxUrl(r.txHash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 truncate text-primary underline-offset-2 transition-colors hover:underline"
                          >
                            <span>✓</span>
                            {shortAddr(r.txHash)} ↗
                          </a>
                        ) : (
                          <span className="text-ink-mute">pending</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* status log */}
            <section>
              <h2 className="mb-3 text-[10px] font-bold uppercase tracking-[0.04em] text-ink-mute">
                Status
              </h2>
              <div className="rounded-2xl border border-hairline bg-canvas p-5 shadow-e1">
                <div className="panel-scroll max-h-32 space-y-1 overflow-y-auto">
                  {statusLog.length === 0 ? (
                    <p className="font-mono text-[12.5px] text-ink-mute">Ready. Connect your wallet to start.</p>
                  ) : (
                    statusLog.map((s, idx) => (
                      <p key={idx} className="font-mono text-[12.5px] text-ink-secondary">
                        {s}
                      </p>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
