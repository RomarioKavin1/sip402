// Documentation page for sip402.
// On-page nav (left rail) → overview → mechanics → packages → quickstart →
// run-the-demo-locally → binding-requirements table → differentiation → FAQ →
// proven-on-chain. The proof section at the bottom links to REAL Basescan txs:
// Base Sepolia for every requirement, Base mainnet for the two production rails.

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Docs · sip402",
  description:
    "How sip402 binds x402 batch-settlement on-chain: ERC-7715 grant, redelegation-as-payment, on-chain period caps, the packages, running the demo, and proven transactions.",
};

// Basescan tx explorer roots and the two Base mainnet production-rail tx hashes
// (gasless 1Shot redemption + paid Venice inference), surfaced in the proof table.
const SEPOLIA = "https://sepolia.basescan.org/tx";
const MAINNET = "https://basescan.org/tx";
const MAINNET_1SHOT = "0x26a44ffedefb113e6a6c1aa266985076684dea9faaea097f92e4f3e1731940e9";
const MAINNET_VENICE = "0x2557becd49e3611b92ae089eb00d867672fcba4b61e2abfcbb6b98c010bc43e9";

// On-this-page anchor nav (left rail), in document order.
const nav = [
  { id: "overview", label: "Overview" },
  { id: "how", label: "How it works" },
  { id: "packages", label: "The packages" },
  { id: "quickstart", label: "Quickstart" },
  { id: "run-the-demo", label: "Run the demo locally" },
  { id: "requirements", label: "Binding requirements" },
  { id: "differentiation", label: "Differentiation" },
  { id: "faq", label: "FAQ" },
  { id: "proof", label: "Proven on-chain" },
];

// ── atoms ────────────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-bold uppercase tracking-[0.04em] text-primary">{children}</p>
  );
}

function H2({ id, eyebrow, children }: { id: string; eyebrow?: string; children: React.ReactNode }) {
  return (
    <div className="scroll-mt-28" id={id}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-2 t-display-lg text-ink">{children}</h2>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="prose-measure mt-4 text-[16px] leading-relaxed text-ink-secondary">{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-canvas-soft px-1.5 py-0.5 font-mono text-[0.85em] text-ink">{children}</code>
  );
}

function Block({ children }: { children: React.ReactNode }) {
  return (
    <pre className="panel-scroll prose-measure mt-5 overflow-x-auto rounded-[24px] bg-ink p-5 font-mono text-[12.5px] leading-relaxed text-canvas/85">
      {children}
    </pre>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-hairline-soft bg-canvas p-6 ${className}`}>{children}</div>
  );
}

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[1280px] px-5 py-14 sm:px-8">
      {/* header */}
      <div className="max-w-3xl">
        <Eyebrow>Documentation</Eyebrow>
        <h1 className="mt-3 t-display-xl text-ink">sip402: open a tab, pay by the sip.</h1>
        <p className="mt-5 text-[18px] font-light leading-relaxed text-ink-secondary">
          The first on-chain, capital-backed binding of x402&apos;s <Code>batch-settlement</Code> scheme. One
          MetaMask permission turns into a standing, revocable USDC session the chain enforces. No custodian.
        </p>
      </div>

      <div className="mt-12 lg:grid lg:grid-cols-[220px_1fr] lg:gap-14">
        {/* side nav */}
        <aside className="mb-10 lg:mb-0">
          <div className="lg:sticky lg:top-28">
            <p className="mb-3 text-[12px] font-bold uppercase tracking-[0.04em] text-ink-mute">On this page</p>
            <nav className="flex flex-col gap-1">
              {nav.map((n) => (
                <a
                  key={n.id}
                  href={`#${n.id}`}
                  className="rounded-pill px-3 py-1.5 text-[14px] font-bold text-ink-secondary transition-colors hover:bg-canvas-soft hover:text-ink"
                >
                  {n.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* content */}
        <article className="min-w-0 space-y-16">
          {/* OVERVIEW */}
          <section>
            <H2 id="overview" eyebrow="Overview">What sip402 is</H2>
            <P>
              sip402 turns one MetaMask ERC-7715 Advanced Permission into a standing, revocable payment session.
              An agent opens a tab once, then sips small USDC draws against it as a paid AI stream is delivered —
              batched on-chain, capped by ERC-7710 caveats, and cancellable mid-sentence.
            </P>
            <P>
              The one idea: <span className="font-bold text-ink">x402 prices the request; sip402 prices the
              delivery.</span> Money, caps, and revocation are on-chain; the resource server (HTTP and AI
              inference) is off-chain by necessity. No intermediary ever holds the buyer&apos;s funds — they leave
              the account only at redemption, bounded by the on-chain caveat.
            </P>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                { k: "Grant", v: "One ERC-7715 permission: a periodic USDC cap." },
                { k: "Spend", v: "The agent batch-redeems commitments against it." },
                { k: "Enforce", v: "The chain reverts the over-cap draw and the revoke." },
              ].map((s) => (
                <Card key={s.k}>
                  <p className="text-[16px] font-bold text-ink">{s.k}</p>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-secondary">{s.v}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* HOW */}
          <section>
            <H2 id="how" eyebrow="Mechanics">How it works</H2>
            <P>
              A buyer grants one periodic delegation (the session). Each request, the buyer&apos;s agent signs a
              redelegation to the seller (the commitment). The seller verifies it by simulating the redemption,
              serves immediately, accumulates the voucher, and redeems a batch of vouchers in one transaction. The
              period caveat enforces the cap on-chain; revoking the root delegation makes the next draw revert.
            </P>
            <Block>{`Buyer (treasury smart account)
   │  openSession: ERC-7710 Erc20PeriodTransfer delegation, cap $X / period
   ▼
Agent (session key)        ← redelegateSession (A2A): orchestrator → specialists
   │  createCommitment: a redelegation agent→seller for this request's amount
   ▼
Seller (@sip402/server)
   │  verify by simulation · accumulate vouchers
   ▼
Delegation Manager ── redeemDelegations (BATCH) ──▶  USDC: treasury → seller
   ERC20PeriodTransferEnforcer caps the total; over-cap reverts (dry-tab)
   testnet: seller submits directly · mainnet: 1Shot relayer (gas in USDC)`}</Block>
          </section>

          {/* PACKAGES */}
          <section>
            <H2 id="packages" eyebrow="Install">The packages</H2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                { k: "@sip402/core", v: "Chain config, SipMeter accounting, the Settler (DirectRedeem on testnet / OneShot on mainnet via 1Shot), 1Shot client." },
                { k: "@sip402/client", v: "Buyer: openSession, redelegateSession (A2A), createCommitment (redelegation-as-payment), revokeSession." },
                { k: "@sip402/server", v: "Seller: verifyCommitment by simulation, CommitmentAccumulator (accept + batch-redeem), x402 HTTP middleware, SSE." },
                { k: "@sip402/splitter", v: "Reference seller reselling Venice behind an OpenAI-compatible gateway; StreamingDrawer for live per-batch draws." },
              ].map((p) => (
                <Card key={p.k}>
                  <a
                    href={`https://www.npmjs.com/package/${p.k}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[15px] font-bold text-primary hover:underline"
                  >
                    {p.k} ↗
                  </a>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-secondary">{p.v}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* QUICKSTART */}
          <section>
            <H2 id="quickstart" eyebrow="Build">Quickstart</H2>
            <P>Install the client and open a session against a USDC treasury.</P>
            <Block>{`pnpm add @sip402/client

# in your agent
import { openSession, createCommitment } from "@sip402/client";

# 1. one periodic grant (the tab)
const session = await openSession({ tokenAddress: USDC, periodAmount, periodDuration });

# 2. per request, sign a redelegation to the seller (the sip)
const commitment = await createCommitment({ session, payTo, amount });`}</Block>
          </section>

          {/* RUN THE DEMO */}
          <section>
            <H2 id="run-the-demo" eyebrow="Try it">Run the demo locally</H2>
            <P>
              The interactive Grant → Spend → Enforce demo ships with its own backend — it signs and submits real
              transactions, so it needs a funded key and an RPC, and runs on your machine rather than a static
              host. It lives in <Code>apps/demo</Code>.
            </P>
            <Block>{`# 1. clone + install (pnpm workspace)
git clone https://github.com/RomarioKavin1/sip402
cd sip402 && pnpm install

# 2. configure the demo backend
cp apps/demo/.env.example apps/demo/.env
#   PRIVATE_KEY=0x...          throwaway key, funded on Base Sepolia
#   SIP_NETWORK=base-sepolia
#   BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# 3. run (frontend + backend, port 3402)
pnpm --filter @sip402/demo dev
#   open http://localhost:3402`}</Block>
            <P>
              Connect MetaMask (Base Sepolia, with Advanced Permissions), approve one ERC-7715 grant, and the
              agent sips against it while the chain enforces the cap. Full prerequisites and troubleshooting are in{" "}
              <a
                href="https://github.com/RomarioKavin1/sip402/blob/main/apps/demo/README.md"
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-primary hover:underline"
              >
                apps/demo/README.md ↗
              </a>
              .
            </P>
          </section>

          {/* REQUIREMENTS */}
          <section>
            <H2 id="requirements" eyebrow="Spec">Binding requirements</H2>
            <P>
              The binding implements x402 <Code>batch-settlement</Code> across two networks (
              <Code>eip155:8453</Code> Base mainnet, <Code>eip155:84532</Code> Base Sepolia). Seven network
              requirements, summarized from the spec:
            </P>
            <div className="mt-6 overflow-hidden rounded-2xl border border-hairline-soft">
              {[
                { k: "Session", v: "A periodic ERC-7710 delegation with the Erc20PeriodTransfer scope (USDC, periodAmount cap, periodDuration). The enforcer caps cumulative transfers per period on-chain." },
                { k: "Commitment", v: "The PaymentPayload.payload is a signed redelegation whose leaf authorizes the seller for this request's amount, with a unique nonce and a validBefore expiry." },
                { k: "Commit", v: "Seller responds 402, buyer returns the commitment, seller verifies, serves immediately, and returns a commitment identifier (voucher hash), not a tx hash." },
                { k: "Accumulate", v: "Seller stores accepted commitments, tracking cumulative authorized amount against the session's remaining on-chain budget, choosing its own redemption cadence." },
                { k: "Redeem", v: "Seller calls redeemDelegations through the Delegation Manager; over-budget redemptions revert atomically. Testnet submits directly; mainnet via the 1Shot relayer, gas in USDC." },
                { k: "Verification", v: "Chain well-formed and signed to root, leaf authorizes this seller, amount within remaining period budget (read on-chain), nonce unseen, validBefore in window, delegation not disabled." },
                { k: "Double-spend prevention", v: "Off-chain per-commitment nonce in the voucher store; on-chain, the period enforcer reverts any redemption exceeding periodAmount regardless of how many commitments are submitted." },
              ].map((r, i) => (
                <div
                  key={r.k}
                  className="grid grid-cols-1 gap-1 border-b border-hairline-soft px-6 py-4 last:border-0 sm:grid-cols-[200px_1fr] sm:gap-6"
                >
                  <div className="flex items-baseline gap-2.5">
                    <span className="tnum text-[13px] font-bold text-primary">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[15px] font-bold text-ink">{r.k}</span>
                  </div>
                  <span className="text-[14px] leading-relaxed text-ink-secondary">{r.v}</span>
                </div>
              ))}
            </div>
          </section>

          {/* DIFFERENTIATION */}
          <section>
            <H2 id="differentiation" eyebrow="Compare">Differentiation</H2>
            <div className="mt-6 grid gap-4">
              {[
                { k: "vs upto", v: "upto settles at most once, after full delivery, trusting the server's metering. sip402 settles many times against one standing authorization; the cap is enforced on-chain, not asserted by the server; and the buyer can revoke mid-stream." },
                { k: "vs @metamask/x402", v: "The official package does per-request delegated payment via a hosted MetaMask facilitator. sip402 adds the session + batched-settlement layer and settles through 1Shot (self-hostable, no ETH float), making the commitment a redelegation — so A2A redelegation is the payment primitive itself." },
                { k: "vs batch-settlement / cloudflare:402", v: "Cloudflare's binding is credit-backed, fiat, off-chain, network-as-merchant-of-record. sip402 is the capital-backed, on-chain, self-custodial binding of the same scheme." },
              ].map((d) => (
                <Card key={d.k}>
                  <p className="font-mono text-[15px] font-bold text-primary">{d.k}</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{d.v}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* FAQ */}
          <section>
            <H2 id="faq" eyebrow="Questions">FAQ</H2>
            <div className="mt-6 grid gap-4">
              {[
                { q: "Isn't it supposed to be fully on-chain?", a: "Money, caps, and revocation are on-chain. HTTP and AI inference are off-chain by necessity. sip402 binds the payment to the delivery without asking you to trust the server with custody or with the meter." },
                { q: "What stops the agent from overspending?", a: "The ERC20PeriodTransferEnforcer. Any draw (or batch of draws) past the periodAmount reverts atomically on-chain — the buyer's signature isn't required to stop it." },
                { q: "Why a separate seller / splitter package?", a: "The seller verifies commitments, accumulates vouchers, and batch-redeems. @sip402/splitter is the reference seller reselling Venice; it's what the live demo's inference path runs through." },
                { q: "Does it need a bundler?", a: "No. Testnet redeems directly via the Delegation Manager. Mainnet settles through the 1Shot relayer with gas paid in USDC — no ETH float, self-hostable." },
              ].map((f) => (
                <Card key={f.q}>
                  <p className="text-[17px] font-bold text-ink">{f.q}</p>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{f.a}</p>
                </Card>
              ))}
            </div>
          </section>

          {/* PROOF */}
          <section>
            <H2 id="proof" eyebrow="Evidence">Proven on-chain</H2>
            <P>
              Every row is a real transaction. The counts differ on purpose: Base Sepolia is free, so every
              requirement is proven there; mainnet runs spend real USDC and gas, so the two production rails
              (gasless 1Shot redemption and paid Venice inference) are each proven once on Base mainnet.
            </P>
            <div className="mt-6 overflow-hidden rounded-2xl border border-hairline-soft">
              {[
                { label: "Periodic delegation · cumulative draws", href: `${SEPOLIA}/0xca047bebde0805b071a3b2eb7d245d61c56ec77550e03635434c6dc20dd8b73b`, net: "sepolia" },
                { label: "Commitment = redelegation · A2A depth-4 chain", href: `${SEPOLIA}/0xcc1ba35facadf92945c01b31da6a9574ceec36a27cddfd29bf36989e9356b153`, net: "sepolia" },
                { label: "Batch redemption · 3 commitments in ONE tx", href: `${SEPOLIA}/0x3b9583c3825612ef2a0bcc5ddbd75efc0ae73c3c897414700ec317a1bb41d9fa`, net: "sepolia" },
                { label: "Live ERC-7715 grant → batched draws → cap revert", href: `${SEPOLIA}/0x606e3f6eccd8b1b203ecd9f4c63d2e6ffee64d8e47b7880775277677414d31bf`, net: "sepolia" },
                { label: "Streaming per-batch draws → dry-tab at cap", href: `${SEPOLIA}/0x5ba8a54a8cd397cd6522d4dd70b4f690fa99fc7d30d11829bccd8711966a931c`, net: "sepolia" },
                { label: "Revoke halts an agent mid-run", href: `${SEPOLIA}/0x9c2ccef0bceec5f82ca8d3ddf0d9a461b57b147ef9860285de874dcc1361a10f`, net: "sepolia" },
                { label: "Mainnet · gasless 1Shot redemption (gas in USDC)", href: `${MAINNET}/${MAINNET_1SHOT}`, net: "mainnet" },
                { label: "Mainnet · real Venice inference, metered per-token", href: `${MAINNET}/${MAINNET_VENICE}`, net: "mainnet" },
              ].map((p) => (
                <a
                  key={p.label}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center justify-between gap-4 border-b border-hairline-soft px-6 py-4 transition-colors last:border-0 hover:bg-canvas-soft"
                >
                  <span className="text-[15px] text-ink-secondary transition-colors group-hover:text-ink">{p.label}</span>
                  <span className="flex shrink-0 items-center gap-2 text-[13px]">
                    <span
                      className={
                        p.net === "mainnet"
                          ? "rounded-pill bg-primary-subdued px-2.5 py-0.5 font-bold text-primary-deep"
                          : "rounded-pill bg-canvas-soft px-2.5 py-0.5 font-bold text-ink-mute"
                      }
                    >
                      {p.net === "mainnet" ? "base" : "sepolia"}
                    </span>
                    <span aria-hidden className="text-ink-mute transition-colors group-hover:text-primary">↗</span>
                  </span>
                </a>
              ))}
            </div>
          </section>

          {/* CTA */}
          <div className="flex flex-wrap gap-3 border-t border-hairline-soft pt-10">
            <a
              href="https://github.com/RomarioKavin1/sip402"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center rounded-pill bg-ink-button px-7 py-3 text-[15px] font-bold text-on-primary transition-colors hover:bg-ink"
            >
              View on GitHub ↗
            </a>
            <Link
              href="/"
              className="inline-flex items-center rounded-pill border-2 border-ink px-7 py-3 text-[15px] font-bold text-ink transition-colors hover:bg-canvas-soft"
            >
              Back to overview
            </Link>
          </div>
        </article>
      </div>
    </div>
  );
}
