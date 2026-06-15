// Landing / hero page for the sip402 marketing site.
// Structure (top → bottom): hero + product mockup → "the one idea" → vs-x402
// comparison → how-it-works → on-chain proof tables → built-on/packages → footer.
// The proof tables below link to REAL Basescan transactions — Base Sepolia for
// every binding requirement, Base mainnet for the two production rails.

import Link from "next/link";
import HeroTicker from "./HeroTicker";

// Basescan tx explorer roots, per network.
const SEPOLIA = "https://sepolia.basescan.org/tx";
const MAINNET = "https://basescan.org/tx";

// Base Sepolia proof rows — one real tx per binding requirement (free testnet).
const testnetProof: Array<{ label: string; hash: string; href: string }> = [
  { label: "Periodic delegation · cumulative draws", hash: "0xca04…b73b", href: `${SEPOLIA}/0xca047bebde0805b071a3b2eb7d245d61c56ec77550e03635434c6dc20dd8b73b` },
  { label: "Over-cap draw reverted on-chain (dry tab)", hash: "0xc478…2655", href: `${SEPOLIA}/0xc478ba71bbaecb66efe3f65866adc6e57675baad05246b3cb4ac9f9c020a2655` },
  { label: "Live ERC-7715 grant → batched draws → cap revert", hash: "0x606e…31bf", href: `${SEPOLIA}/0x606e3f6eccd8b1b203ecd9f4c63d2e6ffee64d8e47b7880775277677414d31bf` },
  { label: "Commitment = redelegation · A2A depth-4 chain", hash: "0xcc1b…b153", href: `${SEPOLIA}/0xcc1ba35facadf92945c01b31da6a9574ceec36a27cddfd29bf36989e9356b153` },
  { label: "Batch redemption · 3 commitments in ONE tx", hash: "0x3b95…d9fa", href: `${SEPOLIA}/0x3b9583c3825612ef2a0bcc5ddbd75efc0ae73c3c897414700ec317a1bb41d9fa` },
  { label: "Streaming per-batch draws → dry-tab at $1.00", hash: "0x5ba8…a931c", href: `${SEPOLIA}/0x5ba8a54a8cd397cd6522d4dd70b4f690fa99fc7d30d11829bccd8711966a931c` },
  { label: "Revoke halts an agent mid-run", hash: "0x9c2c…1a10f", href: `${SEPOLIA}/0x9c2ccef0bceec5f82ca8d3ddf0d9a461b57b147ef9860285de874dcc1361a10f` },
];

// Base mainnet proof — the two production rails, each proven once with real USDC:
// gasless 1Shot redemption (gas paid in USDC) and paid Venice inference.
const MAINNET_1SHOT = "0x26a44ffedefb113e6a6c1aa266985076684dea9faaea097f92e4f3e1731940e9";
const MAINNET_VENICE = "0x2557becd49e3611b92ae089eb00d867672fcba4b61e2abfcbb6b98c010bc43e9";

// ── atoms ─────────────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-bold uppercase tracking-[0.04em] text-ink-mute">
      {children}
    </p>
  );
}

function PrimaryBtn({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-pill bg-ink-button px-7 py-3 text-[15px] font-bold text-on-primary transition-colors hover:bg-ink"
    >
      {children}
    </Link>
  );
}

function GhostBtn({
  href,
  external,
  children,
}: {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  const cls =
    "inline-flex items-center rounded-pill border-2 border-ink px-7 py-3 text-[15px] font-bold text-ink transition-colors hover:bg-canvas-soft";
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

function ProofRow({ label, hash, href }: { label: string; hash: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-4 border-b border-hairline-soft px-6 py-4 transition-colors last:border-0 hover:bg-canvas-soft"
    >
      <span className="text-[15px] text-ink-secondary transition-colors group-hover:text-ink">
        {label}
      </span>
      <span className="tnum flex shrink-0 items-center gap-1.5 font-mono text-[13px] text-ink-mute transition-colors group-hover:text-primary">
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
      <section className="mx-auto grid max-w-[1280px] items-center gap-12 px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="reveal" style={{ animationDelay: "0ms" }}>
            <Label>x402 batch-settlement · on-chain &amp; self-custodial</Label>
          </div>
          <h1 className="reveal mt-5 t-display-xxl text-ink" style={{ animationDelay: "70ms" }}>
            x402&apos;s stream is centralised.
            <br />
            sip402 <span className="text-primary">decentralises</span> it.
          </h1>
          <p
            className="reveal prose-measure mt-6 text-[18px] font-light leading-relaxed text-ink-secondary"
            style={{ animationDelay: "150ms" }}
          >
            x402 ships a <span className="font-normal text-ink">batch-settlement</span> scheme for streaming,
            session-based payments — but its only binding,{" "}
            <span className="font-normal text-ink">cloudflare:402</span>, is centralised: credit-backed,
            off-chain, network-as-merchant. sip402 is the first on-chain, self-custodial binding — gasless
            USDC streams the chain itself caps and revokes. No custodian ever holds the funds.
          </p>
          <div className="reveal mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "220ms" }}>
            <PrimaryBtn href="/docs#run-the-demo">Run the demo</PrimaryBtn>
            <GhostBtn href="/docs">Read the docs</GhostBtn>
          </div>
          <div className="reveal mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]" style={{ animationDelay: "260ms" }}>
            <a
              href="https://www.youtube.com/watch?v=Qz2_zNbeceo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-bold text-ink transition-colors hover:text-primary"
            >
              <span aria-hidden>▶</span> Watch the demo
            </a>
            <a
              href="https://www.youtube.com/watch?v=E8BJL7MallY"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-bold text-ink transition-colors hover:text-primary"
            >
              <span aria-hidden>▶</span> Pitch video
            </a>
          </div>
          <div
            className="reveal mt-10 flex items-baseline gap-3 border-t border-hairline-soft pt-6"
            style={{ animationDelay: "300ms" }}
          >
            <span className="text-[13px] font-bold uppercase tracking-[0.04em] text-ink-mute">
              drawn this session
            </span>
            <HeroTicker />
            <span className="tnum text-[13px] text-ink-mute">USDC</span>
          </div>
        </div>

        <div className="reveal lg:justify-self-end" style={{ animationDelay: "260ms" }}>
          <HeroMockup />
        </div>
      </section>

      {/* ── THE ONE IDEA ─────────────────────────────────────────────────── */}
      <section className="border-t border-hairline-soft bg-canvas-soft">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-24">
          <Label>The problem</Label>
          <h2 className="mt-3 t-display-xl max-w-3xl text-ink">
            The stream existed. The decentralised version didn&apos;t.
          </h2>
          <p className="prose-measure mt-5 text-[17px] font-light leading-relaxed text-ink-secondary">
            x402 already describes streaming, session-based payments — pay as a resource is delivered, settle
            in batches. But the only binding anyone shipped, <span className="font-normal text-ink">cloudflare:402</span>,
            is centralised: a credit balance held by the network, settled off-chain. The trust-minimised, on-chain
            version was in the spec but never built. sip402 builds it.
          </p>

          <div className="mt-10 overflow-hidden rounded-[24px] border border-hairline-soft bg-canvas">
            <div className="hidden grid-cols-[140px_1fr_220px] gap-4 border-b border-hairline-soft px-6 py-3.5 text-[12px] font-bold uppercase tracking-[0.04em] text-ink-mute sm:grid">
              <span>scheme</span>
              <span>what it settles</span>
              <span className="text-right">the catch</span>
            </div>
            {[
              { k: "exact", what: "one transfer, fixed amount, settled once", catch: "no relationship" },
              { k: "upto", what: "settles once after delivery, up to a max", catch: "trust the server's meter" },
              { k: "sip402", what: "a standing session, many small draws", catch: "cap enforced on-chain", lead: true },
            ].map((r) => (
              <div
                key={r.k}
                className={`grid grid-cols-1 gap-1 border-b border-hairline-soft px-6 py-4 last:border-0 sm:grid-cols-[140px_1fr_220px] sm:gap-4 ${
                  r.lead ? "bg-primary-subdued/60" : ""
                }`}
              >
                <span className={`text-[16px] font-bold ${r.lead ? "text-primary-deep" : "text-ink"}`}>
                  {r.k}
                </span>
                <span className="text-[15px] text-ink-secondary">{r.what}</span>
                <span className={`text-[14px] sm:text-right ${r.lead ? "text-primary-deep" : "text-ink-mute"}`}>
                  {r.catch}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── VS x402 ──────────────────────────────────────────────────────── */}
      <section className="border-t border-hairline-soft">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-24">
          <Label>vs the existing x402 implementation</Label>
          <h2 className="mt-3 t-display-xl max-w-3xl text-ink">Built on x402. Past where x402 stops.</h2>
          <p className="prose-measure mt-5 text-[17px] font-light leading-relaxed text-ink-secondary">
            x402 ships <code className="rounded bg-canvas-soft px-1.5 py-0.5 font-mono text-[0.85em] text-ink">exact</code> and{" "}
            <code className="rounded bg-canvas-soft px-1.5 py-0.5 font-mono text-[0.85em] text-ink">upto</code>; the official{" "}
            <code className="rounded bg-canvas-soft px-1.5 py-0.5 font-mono text-[0.85em] text-ink">@metamask/x402</code> does
            per-request delegated payments through a hosted facilitator. None of them open a standing session
            whose cap the chain enforces.
          </p>

          {/* similarities */}
          <div className="mt-10 rounded-[24px] border border-hairline-soft bg-canvas p-7 sm:p-8">
            <p className="t-heading-lg text-ink">It is x402: same handshake, same envelope.</p>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              {[
                { k: "402 handshake", v: "Server replies 402, the client returns a PaymentPayload, the seller verifies and settles." },
                { k: "Same envelope", v: "PaymentRequirements and PaymentPayload, the scheme and network fields, the facilitator roles." },
                { k: "Scheme registry", v: "Registers as batch-settlement on Base — eip155:8453 and eip155:84532." },
              ].map((s) => (
                <div key={s.k}>
                  <p className="text-[15px] font-bold text-primary-deep">{s.k}</p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-secondary">{s.v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* differences */}
          <p className="mb-3 mt-10 text-[13px] font-bold uppercase tracking-[0.04em] text-ink-mute">Where they diverge</p>
          <div className="overflow-hidden rounded-[24px] border border-hairline-soft bg-canvas">
            <div className="hidden grid-cols-[200px_1fr_1fr] border-b border-hairline-soft bg-canvas-soft px-6 py-3.5 text-[12px] font-bold uppercase tracking-[0.04em] text-ink-mute sm:grid">
              <span>capability</span>
              <span>x402 today</span>
              <span className="text-primary-deep">sip402</span>
            </div>
            {[
              { cap: "Payment shape", x402: "One transfer per request — settled once (exact) or up to a max after delivery (upto).", sip: "One standing session; many small draws batched into a single redeemDelegations tx." },
              { cap: "Who guarantees the cap", x402: "The server's meter, or a per-request signature you have to trust.", sip: "An on-chain enforcer — ERC20PeriodTransferEnforcer reverts any over-cap draw." },
              { cap: "Relationship", x402: "Stateless. Re-authorize on every single request.", sip: "Open a tab once, sip against it until you revoke." },
              { cap: "Revocation", x402: "None mid-stream — you just stop sending requests.", sip: "disableDelegation halts the next draw on-chain, mid-sentence." },
              { cap: "Settlement rail", x402: "Hosted facilitator as merchant-of-record, including @metamask/x402.", sip: "1Shot relayer — self-hostable, gas paid in USDC, no ETH float." },
              { cap: "Custody", x402: "Credit-backed / facilitator-held in the shipped batch-settlement binding.", sip: "Self-custodial. Funds leave only at redemption, bounded by the caveat." },
            ].map((r) => (
              <div
                key={r.cap}
                className="grid grid-cols-1 gap-2 border-b border-hairline-soft px-6 py-5 last:border-0 sm:grid-cols-[200px_1fr_1fr] sm:gap-6"
              >
                <span className="text-[15px] font-bold text-ink">{r.cap}</span>
                <div>
                  <span className="mb-1 block text-[12px] font-bold uppercase tracking-[0.04em] text-ink-mute sm:hidden">x402 today</span>
                  <span className="text-[15px] leading-relaxed text-ink-mute">{r.x402}</span>
                </div>
                <div className="rounded-2xl bg-primary-subdued/60 px-4 py-2.5">
                  <span className="mb-1 block text-[12px] font-bold uppercase tracking-[0.04em] text-primary-deep sm:hidden">sip402</span>
                  <span className="text-[15px] leading-relaxed text-ink-secondary">{r.sip}</span>
                </div>
              </div>
            ))}
          </div>

          {/* expansion — dark promo strip */}
          <div className="mt-10 rounded-[32px] bg-ink p-8 text-canvas sm:p-10">
            <p className="text-[13px] font-bold uppercase tracking-[0.04em] text-canvas/60">How sip402 expands batch-settlement</p>
            <p className="prose-measure mt-3 text-[17px] font-light leading-relaxed text-canvas/85">
              <span className="font-normal text-canvas">batch-settlement</span> is described in the x402 spec as a
              capital-backed, delegated-authorization model, but its only shipped binding,{" "}
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-canvas">cloudflare:402</code>,
              is credit-backed fiat, settled off-chain, with the network as merchant-of-record.
            </p>
            <p className="prose-measure mt-4 text-[17px] font-light leading-relaxed text-canvas/85">
              sip402 is the first <span className="font-normal text-canvas">capital-backed, on-chain, self-custodial</span>{" "}
              binding of the same scheme: the commitment is an ERC-7710 redelegation, the cap is an on-chain caveat,
              settlement is a real redeemDelegations batch, and A2A redelegation lets one session fan out to many agents.
            </p>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
      <section className="border-t border-hairline-soft bg-canvas-soft">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-24">
          <Label>How it works</Label>
          <h2 className="mt-3 t-display-xl max-w-3xl text-ink">Grant. Spend. Enforce.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-3">
            {[
              { n: "01", tag: "Grant", line: "One MetaMask ERC-7715 Advanced Permission. A periodic USDC allowance, capped per period." },
              { n: "02", tag: "Spend", line: "The agent sips USDC per request. Each commitment is a redelegation to the seller; vouchers batch into one tx." },
              { n: "03", tag: "Enforce", line: "The ERC20PeriodTransferEnforcer reverts the over-cap draw. disableDelegation revokes mid-stream." },
            ].map((s) => (
              <div key={s.n} className="rounded-2xl border border-hairline-soft bg-canvas p-7">
                <span className="tnum text-[14px] font-bold text-primary">{s.n}</span>
                <h3 className="mt-3 t-heading-lg text-ink">{s.tag}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{s.line}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROOF ────────────────────────────────────────────────────────── */}
      <section id="proof" className="border-t border-hairline-soft">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-24">
          <Label>Proven on-chain</Label>
          <h2 className="mt-3 t-display-lg max-w-3xl text-ink">Every claim is a real transaction.</h2>
          <p className="prose-measure mt-4 text-[16px] text-ink-secondary">
            Credibility comes from <span className="font-bold text-ink">here is the tx</span>, not from adjectives. Each row links to Basescan.
          </p>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.04em] text-ink-mute">Base Sepolia</p>
              <div className="overflow-hidden rounded-2xl border border-hairline-soft bg-canvas">
                {testnetProof.map((p) => (
                  <ProofRow key={p.label} {...p} />
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.04em] text-ink-mute">Base mainnet</p>
              <div className="overflow-hidden rounded-2xl border border-hairline-soft bg-canvas">
                <ProofRow label="1Shot gasless redemption · gas paid in USDC" hash="0x26a4…40e9" href={`${MAINNET}/${MAINNET_1SHOT}`} />
                <ProofRow label="Real Venice inference · per-token draws" hash="0x2557…43e9" href={`${MAINNET}/${MAINNET_VENICE}`} />
              </div>
              <p className="prose-measure mt-4 text-[14px] leading-relaxed text-ink-mute">
                The counts differ on purpose: Sepolia is free, so every requirement is proven there; mainnet
                runs spend real USDC, so the two production rails (gasless 1Shot redemption, paid Venice
                inference) are each proven once on Base mainnet.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── BUILT ON ─────────────────────────────────────────────────────── */}
      <section className="border-t border-hairline-soft bg-canvas-soft">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-24">
          <Label>Built on</Label>
          <div className="mt-8 grid gap-10 lg:grid-cols-2">
            <div className="space-y-5">
              {[
                { k: "MetaMask Smart Accounts Kit", v: "ERC-7715 advanced permissions · ERC-7710 redelegation" },
                { k: "1Shot Permissionless Relayer", v: "EIP-7702 · gas paid in USDC · webhooks" },
                { k: "Venice AI", v: "x402-metered inference behind an OpenAI-compatible gateway" },
              ].map((s) => (
                <div key={s.k} className="border-b border-hairline-soft pb-5 last:border-0">
                  <p className="text-[16px] font-bold text-ink">{s.k}</p>
                  <p className="mt-1 font-mono text-[13px] text-ink-mute">{s.v}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.04em] text-ink-mute">npm packages</p>
              <div className="overflow-hidden rounded-2xl border border-hairline-soft bg-canvas">
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
                    className="group flex items-center justify-between gap-4 border-b border-hairline-soft px-6 py-4 transition-colors last:border-0 hover:bg-canvas-soft"
                  >
                    <span className="font-mono text-[15px] font-bold text-ink transition-colors group-hover:text-primary">{p.k}</span>
                    <span className="hidden text-[13px] text-ink-mute sm:block">{p.v}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-3">
            <PrimaryBtn href="/docs#run-the-demo">Run the demo</PrimaryBtn>
            <GhostBtn href="https://github.com/RomarioKavin1/sip402" external>
              View on GitHub ↗
            </GhostBtn>
          </div>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-hairline-soft">
        <div className="mx-auto flex max-w-[1280px] flex-col gap-4 px-5 py-12 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="text-[18px] font-bold text-ink">sip402</p>
            <p className="mt-1 text-[13px] text-ink-mute">Session-Initiated Payments. Open a tab, pay by the sip.</p>
          </div>
          <div className="flex flex-wrap gap-6 text-[14px] font-bold text-ink-mute">
            <Link href="/docs" className="transition-colors hover:text-ink">Docs</Link>
            <a href="https://github.com/RomarioKavin1/sip402" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-ink">GitHub ↗</a>
            <a href="https://www.npmjs.com/package/@sip402/core" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-ink">npm ↗</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

// ── product-feature mockup card ──────────────────────────────────────────────

function HeroMockup() {
  const receipts = [
    { amt: "0.120000", note: "3 commitments → 1 tx", ok: true },
    { amt: "0.120000", note: "3 commitments → 1 tx", ok: true },
    { amt: "0.120000", note: "cap reached", ok: false },
  ];
  return (
    <div className="w-full max-w-[440px] rounded-[32px] border border-hairline-soft bg-canvas p-7 shadow-e1">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-[0.04em] text-ink-mute">Total drawn · USDC</span>
        <span className="rounded-pill bg-canvas-soft px-3 py-1 text-[12px] font-bold text-ink-mute">Base Sepolia</span>
      </div>
      <div className="tnum mt-3 text-5xl font-medium text-ink">
        <span className="text-ink-mute">$</span>0.240000
      </div>
      <div className="mt-5">
        <div className="h-2 w-full overflow-hidden rounded-pill bg-canvas-soft">
          <div className="h-2 rounded-pill bg-primary" style={{ width: "80%" }} />
        </div>
        <div className="tnum mt-2 flex items-center justify-between text-[12px] text-ink-mute">
          <span>80% of cap</span>
          <span>cap $0.30</span>
        </div>
      </div>
      <div className="mt-5 space-y-2 border-t border-hairline-soft pt-4">
        {receipts.map((r, i) => (
          <div key={i} className="flex items-center gap-3 text-[13px]">
            <span className="w-12 shrink-0 font-bold text-ink-secondary">batch</span>
            <span className="tnum font-mono text-ink">${r.amt}</span>
            <span className="ml-auto text-[12px]">
              {r.ok ? (
                <span className="font-bold text-primary">✓ {r.note}</span>
              ) : (
                <span className="font-bold text-critical">reverted · {r.note}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
