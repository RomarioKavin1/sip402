# sip402

**Session-Initiated Payments — open a tab, pay by the sip.**

sip402 turns one MetaMask permission into a *standing, revocable payment session*. An agent opens a tab once, then "sips" small USDC draws against it as a paid AI stream is delivered — batched on-chain, capped by ERC-7710 caveats, and cancellable mid-sentence.

It is the **first capital-backed, ERC-7710 EVM binding of x402's `batch-settlement` scheme** — the on-chain, self-custodial counterpart of the scheme whose only shipped binding (`cloudflare:402`) is credit-backed fiat. The payment commitment *is* an ERC-7710 redelegation to the seller; the seller accumulates commitments and redeems them in batches through the MetaMask Delegation Manager. See [`SPEC.md`](./SPEC.md) for the full binding specification. **x402 prices the request; sip402 prices the delivery.**

## Why

Every AI service prices by the token, but every crypto-AI payment scheme prices a fixed amount decided *before* delivery. `exact` is one-shot. `upto` settles **once**, after full delivery, and asks you to trust the server not to overcharge. Prepaid balances lock a per-provider minimum into someone else's custody. Nothing meters a *standing relationship* — many requests, paid in batches as they stream, exposure bounded to one batch, shut off mid-stream with on-chain enforcement.

ERC-7710 delegation is the only x402 payment method marked **multi-use** in the spec, and `batch-settlement` describes the capital-backed delegated-authorization model in prose — but no one shipped the on-chain binding. sip402 is that binding.

## How it works

```
Buyer (treasury smart account)
   │  openSession: ERC-7710 Erc20PeriodTransfer delegation, cap $X / period
   ▼
Agent (session key)                          ← redelegateSession (A2A): orchestrator → specialists
   │  createCommitment: a redelegation agent→seller for this request's amount
   ▼                                            (the x402 PAYMENT is a delegation)
Seller (@sip402/server / splitter)
   │  verify by simulation · accumulate vouchers
   ▼
Delegation Manager  ── redeemDelegations (BATCH) ──▶  USDC: treasury → seller
   on-chain Erc20PeriodTransferEnforcer caps the total; over-cap reverts (dry-tab)
   testnet: seller submits directly · mainnet: 1Shot relayer (gas in USDC)
```

A buyer grants one periodic delegation. Each request, the buyer's agent signs a **redelegation to the seller** (the commitment). The seller verifies it by simulating the redemption, serves immediately, accumulates the voucher, and redeems a **batch** of vouchers in one transaction. The period caveat enforces the cap on-chain; revoking the root delegation makes the next draw revert.

## Proven on Base Sepolia (real transactions)

Every claim below is a real on-chain transaction (`packages/*/scripts/*-proof.ts`):

| Mechanism | Evidence |
|---|---|
| Periodic delegation, cumulative draws, **over-cap revert** | rail-proof: draws [`0xca04…`](https://sepolia.basescan.org/tx/0xca047bebde0805b071a3b2eb7d245d61c56ec77550e03635434c6dc20dd8b73b) / [`0xa398…`](https://sepolia.basescan.org/tx/0xa39862f943deeb1af75002b2985362aeaa5fcc0dbddc533b34321cbc385ec47d), over-cap reverted `0xc478…` |
| **Commitment = redelegation to seller**, A2A **depth-4 chain** redeemed, revoke | binding-proof: A2A [`0xcc1b…`](https://sepolia.basescan.org/tx/0xcc1ba35facadf92945c01b31da6a9574ceec36a27cddfd29bf36989e9356b153), revoke `0xe355…` |
| **Batch redemption — 3 commitments in ONE tx** | server-proof: [`0x3b95…`](https://sepolia.basescan.org/tx/0x3b9583c3825612ef2a0bcc5ddbd75efc0ae73c3c897414700ec317a1bb41d9fa) (3 transfers, 1 tx) |
| **Streaming per-batch draws** (live ticker) → dry-tab at cap | splitter-proof: 4 draws [`0x5ba8…`](https://sepolia.basescan.org/tx/0x5ba8a54a8cd397cd6522d4dd70b4f690fa99fc7d30d11829bccd8711966a931c) → $1.00 → revert |
| Demo: cascade → draws → **revoke halts an agent mid-run** | demo: revoke [`0x9c2c…`](https://sepolia.basescan.org/tx/0x9c2ccef0bceec5f82ca8d3ddf0d9a461b57b147ef9860285de874dcc1361a10f) |

Verification on testnet uses direct `redeemDelegations` (no bundler). The 1Shot relayer and Venice are **Base mainnet only** — wired and runnable, exercised in the mainnet demo.

## Packages

| Package | Role |
|---|---|
| [`@sip402/core`](./packages/core) | Chain config, `SipMeter` accounting, `Settler` (DirectRedeem testnet / OneShot mainnet via 1Shot), 1Shot client. |
| [`@sip402/client`](./packages/client) | Buyer: `openSession`, `redelegateSession` (A2A), `createCommitment` (redelegation-as-payment), `revokeSession`. |
| [`@sip402/server`](./packages/server) | Seller: `verifyCommitment` (by simulation), `CommitmentAccumulator` (accept + batch-redeem), x402 HTTP middleware, SSE. |
| [`@sip402/splitter`](./packages/splitter) | Reference seller reselling Venice behind an OpenAI-compatible gateway; `StreamingDrawer` (live per-batch draws). |
| [`apps/demo`](./apps/demo) | Live dashboard: delegation tree, USDC ticker, receipt feed, revoke. |

## How it differs

**vs `upto`** — `upto` settles at most once, after full delivery, trusting the server's metering. sip402 settles **many** times against one standing authorization, the cap is enforced **on-chain** (not asserted by the server), and the buyer can revoke mid-stream.

**vs `@metamask/x402`** — the official package does per-request delegated payment via a hosted MetaMask facilitator. sip402 adds the **session + batched-settlement** layer on top and settles through **1Shot** (self-hostable, no ETH float) — and makes the commitment a redelegation, so A2A redelegation is the payment primitive itself.

**vs `batch-settlement` / `cloudflare:402`** — Cloudflare's binding is credit-backed, fiat, off-chain, network-as-merchant-of-record. sip402 is the **capital-backed, on-chain, self-custodial** binding of the same scheme.

## Run it

```bash
pnpm install
pnpm -r test          # unit tests (pure logic; no network)
pnpm -r typecheck

# On-chain proofs (real Base Sepolia txs — needs PRIVATE_KEY in .env, funded with testnet ETH + USDC)
pnpm -C packages/core      exec tsx scripts/rail-proof.ts
pnpm -C packages/client    exec tsx scripts/binding-proof.ts
pnpm -C packages/server    exec tsx scripts/server-proof.ts
pnpm -C packages/splitter  splitter-proof

# Live dashboard
pnpm -C apps/demo dev      # http://localhost:3000
```

`.env` (gitignored) needs `PRIVATE_KEY` (a Base Sepolia wallet funded with a little ETH + test USDC). Default network is `base-sepolia`; set `SIP_NETWORK=base` for mainnet.

## Stack

MetaMask Smart Accounts Kit (ERC-7715 / ERC-7710) · 1Shot Permissionless Relayer (EIP-7702, gas in USDC, webhooks) · Venice AI (x402-metered) · Base.

## License

MIT
