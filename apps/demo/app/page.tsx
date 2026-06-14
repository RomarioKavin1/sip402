import Link from "next/link";
import HeroTicker from "./HeroTicker";

// ── Proof links (real on-chain evidence; README "Proven on Base Sepolia") ────

const SEPOLIA = "https://sepolia.basescan.org/tx";
const MAINNET = "https://basescan.org/tx";

const testnetProof: Array<{ label: string; hash: string; href: string }> = [
  {
    label: "Periodic delegation · cumulative draws",
    hash: "0xca04…b73b",
    href: `${SEPOLIA}/0xca047bebde0805b071a3b2eb7d245d61c56ec77550e03635434c6dc20dd8b73b`,
  },
  {
    label: "Over-cap draw reverted on-chain (dry tab)",
    hash: "0xc478…2655",
    href: `${SEPOLIA}/0xc478ba71bbaecb66efe3f65866adc6e57675baad05246b3cb4ac9f9c020a2655`,
  },
  {
    label: "Commitment = redelegation · A2A depth-4 chain",
    hash: "0xcc1b…b153",
    href: `${SEPOLIA}/0xcc1ba35facadf92945c01b31da6a9574ceec36a27cddfd29bf36989e9356b153`,
  },
  {
    label: "Batch redemption · 3 commitments in ONE tx",
    hash: "0x3b95…d9fa",
    href: `${SEPOLIA}/0x3b9583c3825612ef2a0bcc5ddbd75efc0ae73c3c897414700ec317a1bb41d9fa`,
  },
  {
    label: "Streaming per-batch draws → dry-tab at $1.00",
    hash: "0x5ba8…a931c",
    href: `${SEPOLIA}/0x5ba8a54a8cd397cd6522d4dd70b4f690fa99fc7d30d11829bccd8711966a931c`,
  },
  {
    label: "Revoke halts an agent mid-run",
    hash: "0x9c2c…1a10f",
    href: `${SEPOLIA}/0x9c2ccef0bceec5f82ca8d3ddf0d9a461b57b147ef9860285de874dcc1361a10f`,
  },
];

const MAINNET_1SHOT =
  "0x26a44ffedefb113e6a6c1aa266985076684dea9faaea097f92e4f3e1731940e9";
const MAINNET_VENICE =
  "0x2557becd49e3611b92ae089eb00d867672fcba4b61e2abfcbb6b98c010bc43e9";

// ── small presentational atoms ───────────────────────────────────────────────

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.2em] text-amber">
      {children}
    </p>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-text-faint">
      {children}
    </p>
  );
}

function ProofRow({
  label,
  hash,
  href,
}: {
  label: string;
  hash: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-4 border-b border-line-soft py-3 transition-colors last:border-0 hover:bg-ink-2"
    >
      <span className="text-sm text-text-dim transition-colors group-hover:text-text">
        {label}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-text-faint transition-colors group-hover:text-amber">
        {hash}
        <span aria-hidden>↗</span>
      </span>
    </a>
  );
}

export default function Home() {
  return (
    <main>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28">
        <div className="reveal" style={{ animationDelay: "0ms" }}>
          <Kicker>x402 binding · batch-settlement · ERC-7710</Kicker>
        </div>

        <h1
          className="reveal mt-6 max-w-4xl display-1 font-extrabold text-text"
          style={{ animationDelay: "80ms" }}
        >
          Open a tab.
          <br />
          Pay <span className="text-amber">by the sip.</span>
        </h1>

        <p
          className="reveal mt-8 prose-measure text-lg leading-relaxed text-text-dim"
          style={{ animationDelay: "160ms" }}
        >
          One MetaMask permission opens a metered, revocable USDC session. An
          agent sips against it as a paid AI stream is delivered. The chain
          enforces the cap and the revoke. No custodian ever holds the funds.
        </p>

        <div
          className="reveal mt-10 flex flex-wrap items-center gap-4"
          style={{ animationDelay: "240ms" }}
        >
          <Link
            href="/dashboard"
            className="rounded-md border border-amber bg-amber px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-amber-deep"
          >
            Launch the demo
          </Link>
          <Link
            href="/docs"
            className="rounded-md border rule px-5 py-2.5 text-sm font-medium text-text transition-colors hover:bg-ink-2"
          >
            Read the docs
          </Link>
        </div>

        {/* live-feel amber ticker motif (decorative, counts on the client) */}
        <div
          className="reveal mt-16 inline-flex items-baseline gap-3 border-t rule pt-6"
          style={{ animationDelay: "320ms" }}
        >
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-text-faint">
            drawn this session
          </span>
          <HeroTicker />
          <span className="font-mono text-xs text-text-faint">USDC</span>
        </div>
      </section>

      {/* ── THE INSIGHT ──────────────────────────────────────────────────── */}
      <section className="border-t rule">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionLabel>The one idea</SectionLabel>
          <h2 className="max-w-3xl display-2 font-semibold text-text">
            x402 prices the request.
            <br />
            sip402 prices the <span className="text-amber">delivery.</span>
          </h2>

          <div className="mt-12 overflow-hidden rounded-lg border rule">
            <div className="grid grid-cols-[88px_1fr] items-center gap-4 border-b rule bg-ink-2 px-5 py-3 font-mono text-xs uppercase tracking-wider text-text-faint sm:grid-cols-[120px_1fr_220px]">
              <span>scheme</span>
              <span className="hidden sm:block">what it settles</span>
              <span className="sm:text-right">the catch</span>
            </div>
            {[
              {
                k: "exact",
                what: "one transfer, fixed amount, settled once",
                catch: "no relationship",
              },
              {
                k: "upto",
                what: "settles once after delivery, up to a max",
                catch: "trust the server's meter",
              },
              {
                k: "sip402",
                what: "a standing session, many small draws",
                catch: "cap enforced on-chain",
                amber: true,
              },
            ].map((r) => (
              <div
                key={r.k}
                className="grid grid-cols-[88px_1fr] items-center gap-4 border-b border-line-soft px-5 py-4 last:border-0 sm:grid-cols-[120px_1fr_220px]"
              >
                <span
                  className={`font-mono text-sm ${
                    r.amber ? "font-medium text-amber" : "text-text-dim"
                  }`}
                >
                  {r.k}
                </span>
                <span className="text-sm text-text-dim">{r.what}</span>
                <span
                  className={`font-mono text-xs sm:text-right ${
                    r.amber ? "text-amber" : "text-text-faint"
                  }`}
                >
                  {r.catch}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS — Grant → Spend → Enforce ───────────────────────── */}
      <section className="border-t rule">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionLabel>How it works</SectionLabel>
          <h2 className="max-w-3xl display-2 font-semibold text-text">
            Grant <span className="text-text-faint">→</span> Spend{" "}
            <span className="text-text-faint">→</span> Enforce
          </h2>

          <div className="mt-12 grid gap-px overflow-hidden rounded-lg border rule sm:grid-cols-3">
            {[
              {
                n: "01",
                tag: "Grant",
                line: "One MetaMask ERC-7715 Advanced Permission. A periodic USDC allowance, capped per period.",
              },
              {
                n: "02",
                tag: "Spend",
                line: "The agent sips USDC per request. Each commitment is a redelegation to the seller; vouchers batch into one tx.",
              },
              {
                n: "03",
                tag: "Enforce",
                line: "The ERC20PeriodTransferEnforcer reverts the over-cap draw. disableDelegation revokes mid-stream.",
              },
            ].map((s) => (
              <div key={s.n} className="bg-ink-2 p-6 sm:p-8">
                <span className="font-mono text-xs text-amber">{s.n}</span>
                <h3 className="mt-3 text-lg font-medium text-text">{s.tag}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-dim">
                  {s.line}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ON-CHAIN ENFORCEMENT, OFF-CHAIN DELIVERY ─────────────────────── */}
      <section className="border-t rule">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionLabel>The premise</SectionLabel>
          <h2 className="max-w-3xl display-3 font-semibold text-text">
            Isn&apos;t it supposed to be fully on-chain?
          </h2>
          <div className="mt-8 grid gap-10 sm:grid-cols-2">
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-amber">
                on-chain
              </p>
              <p className="mt-3 prose-measure text-text-dim">
                Money, caps, and revocation. The{" "}
                <span className="font-mono text-text">
                  ERC20PeriodTransferEnforcer
                </span>{" "}
                reverts any draw past the cap.{" "}
                <span className="font-mono text-text">disableDelegation</span>{" "}
                cancels the session. The buyer&apos;s funds never leave their
                account until redemption. No intermediary underwrites either
                side.
              </p>
            </div>
            <div>
              <p className="font-mono text-xs uppercase tracking-wider text-text-faint">
                off-chain
              </p>
              <p className="mt-3 prose-measure text-text-dim">
                The resource server. HTTP and AI inference are off-chain by
                necessity. sip402 binds the payment to the delivery without
                asking you to trust the server with custody or with the meter.
                The chain is the arbiter of value.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROOF ────────────────────────────────────────────────────────── */}
      <section className="border-t rule">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionLabel>Proven on-chain</SectionLabel>
          <h2 className="max-w-3xl display-3 font-semibold text-text">
            Every claim is a real transaction.
          </h2>
          <p className="mt-4 prose-measure text-text-dim">
            Credibility comes from <span className="text-text">here is the tx</span>,
            not from adjectives. Each row links to Basescan.
          </p>

          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-wider text-text-faint">
                Base Sepolia
              </p>
              <div className="rounded-lg border rule bg-ink px-5">
                {testnetProof.map((p) => (
                  <ProofRow key={p.label} {...p} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-wider text-text-faint">
                Base mainnet
              </p>
              <div className="rounded-lg border rule bg-ink px-5">
                <ProofRow
                  label="1Shot gasless redemption · gas paid in USDC"
                  hash="0x26a4…40e9"
                  href={`${MAINNET}/${MAINNET_1SHOT}`}
                />
                <ProofRow
                  label="Real Venice inference · per-token draws"
                  hash="0x2557…43e9"
                  href={`${MAINNET}/${MAINNET_VENICE}`}
                />
              </div>
              <p className="mt-4 prose-measure text-sm leading-relaxed text-text-faint">
                Testnet uses direct redeemDelegations (no bundler). The 1Shot
                relayer and Venice are mainnet, wired and runnable, exercised in
                the live demo.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── BUILT ON ─────────────────────────────────────────────────────── */}
      <section className="border-t rule">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <SectionLabel>Built on</SectionLabel>
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-5">
              {[
                {
                  k: "MetaMask Smart Accounts Kit",
                  v: "ERC-7715 advanced permissions · ERC-7710 redelegation",
                },
                {
                  k: "1Shot Permissionless Relayer",
                  v: "EIP-7702 · gas paid in USDC · webhooks",
                },
                {
                  k: "Venice AI",
                  v: "x402-metered inference behind an OpenAI-compatible gateway",
                },
              ].map((s) => (
                <div key={s.k} className="border-b border-line-soft pb-5 last:border-0">
                  <p className="text-sm font-medium text-text">{s.k}</p>
                  <p className="mt-1 font-mono text-xs text-text-faint">{s.v}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-4 font-mono text-xs uppercase tracking-wider text-text-faint">
                npm packages
              </p>
              <div className="rounded-lg border rule bg-ink px-5">
                {[
                  { k: "@sip402/core", v: "chain config · meter · settler" },
                  { k: "@sip402/client", v: "openSession · createCommitment · revoke" },
                  { k: "@sip402/server", v: "verify · accumulate · batch-redeem" },
                  { k: "@sip402/splitter", v: "reference seller · streaming draws" },
                ].map((p) => (
                  <a
                    key={p.k}
                    href={`https://www.npmjs.com/package/${p.k}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-between gap-4 border-b border-line-soft py-3 transition-colors last:border-0"
                  >
                    <span className="font-mono text-sm text-text-dim transition-colors group-hover:text-amber">
                      {p.k}
                    </span>
                    <span className="hidden font-mono text-xs text-text-faint sm:block">
                      {p.v}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-16 flex flex-wrap items-center gap-4">
            <Link
              href="/dashboard"
              className="rounded-md border border-amber bg-amber px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-amber-deep"
            >
              Launch the demo
            </Link>
            <a
              href="https://github.com/RomarioKavin1/sip402"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border rule px-5 py-2.5 text-sm font-medium text-text transition-colors hover:bg-ink-2"
            >
              View on GitHub ↗
            </a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t rule">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="font-mono text-sm font-bold text-text">
              sip<span className="text-amber">402</span>
            </p>
            <p className="mt-1 text-xs text-text-faint">
              Session-Initiated Payments. Open a tab, pay by the sip.
            </p>
          </div>
          <div className="flex flex-wrap gap-5 font-mono text-xs text-text-faint">
            <Link href="/docs" className="transition-colors hover:text-text">
              Docs
            </Link>
            <Link href="/dashboard" className="transition-colors hover:text-text">
              Demo
            </Link>
            <a
              href="https://github.com/RomarioKavin1/sip402"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-text"
            >
              GitHub ↗
            </a>
            <a
              href="https://www.npmjs.com/package/@sip402/core"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-text"
            >
              npm ↗
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
