# sip402

**x402's payment stream is centralised. sip402 decentralises it.**

**[▶ Demo video](https://www.youtube.com/watch?v=Qz2_zNbeceo)** · **[▶ Pitch video](https://www.youtube.com/watch?v=Fv4UGc-FGMw)** · **[Live site ↗](https://sip402.vercel.app)** · **[Docs ↗](https://sip402.vercel.app/docs)** · **[npm](https://www.npmjs.com/package/@sip402/core)** · [SPEC](./SPEC.md) · [Feedback](./FEEDBACK.md)

x402 ships a `batch-settlement` scheme for **streaming, session-based payments** — pay as a resource is delivered, settle in batches. But its only real-world binding, **`cloudflare:402`**, is **centralised**: a credit balance held by the network, settled off-chain, with the network as merchant-of-record. You stream now and trust an intermediary to settle later. The trust-minimised, on-chain version was described in the spec but **never shipped**.

**sip402 is that binding** — the first **capital-backed, on-chain, self-custodial** binding of x402's `batch-settlement`. One MetaMask ERC-7715 permission opens a standing, revocable USDC session. The payment commitment *is* an ERC-7710 redelegation to the seller; the seller redeems commitments in **batches** through the MetaMask Delegation Manager; the cap is enforced **on-chain** by an ERC-7710 caveat (over-budget reverts atomically); and settlement is **gasless** via the 1Shot relayer. No custodian, no credit, no trust. See [`SPEC.md`](./SPEC.md) for the full binding specification.

**x402 prices the request; sip402 prices the delivery.**

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

## Proven on-chain (real transactions)

The same binding runs on two networks, and the proof counts differ on purpose. **Base Sepolia is free, so every individual requirement is proven there** with its own transaction (`packages/*/scripts/*-proof.ts`). **Mainnet runs spend real USDC and gas, so the two production rails — gasless 1Shot redemption and paid Venice inference — are each proven once on Base mainnet.** Exhaustive coverage on testnet; the money rails confirmed on mainnet.

### Base Sepolia — every requirement

| Mechanism | Evidence |
|---|---|
| Periodic delegation, cumulative draws, **over-cap revert** | rail-proof: draws [`0xca04…`](https://sepolia.basescan.org/tx/0xca047bebde0805b071a3b2eb7d245d61c56ec77550e03635434c6dc20dd8b73b) / [`0xa398…`](https://sepolia.basescan.org/tx/0xa39862f943deeb1af75002b2985362aeaa5fcc0dbddc533b34321cbc385ec47d), over-cap reverted `0xc478…` |
| **Commitment = redelegation to seller**, A2A **depth-4 chain** redeemed | binding-proof: A2A [`0xcc1b…`](https://sepolia.basescan.org/tx/0xcc1ba35facadf92945c01b31da6a9574ceec36a27cddfd29bf36989e9356b153) (revoke proven separately, below) |
| **Batch redemption — 3 commitments in ONE tx** | server-proof: [`0x3b95…`](https://sepolia.basescan.org/tx/0x3b9583c3825612ef2a0bcc5ddbd75efc0ae73c3c897414700ec317a1bb41d9fa) (3 transfers, 1 tx) |
| **Streaming per-batch draws** (live ticker) → dry-tab at cap | splitter-proof: 4 draws [`0x5ba8…`](https://sepolia.basescan.org/tx/0x5ba8a54a8cd397cd6522d4dd70b4f690fa99fc7d30d11829bccd8711966a931c) → $1.00 → revert |
| Demo: cascade → draws → **revoke halts an agent mid-run** | demo: revoke [`0x9c2c…`](https://sepolia.basescan.org/tx/0x9c2ccef0bceec5f82ca8d3ddf0d9a461b57b147ef9860285de874dcc1361a10f) |
| **Live MetaMask ERC-7715 grant → batched draws → cap revert** | demo: batch [`0x606e…`](https://sepolia.basescan.org/tx/0x606e3f6eccd8b1b203ecd9f4c63d2e6ffee64d8e47b7880775277677414d31bf) (3 commitments, 1 tx); over-cap batch reverts |

### Base mainnet — the production rails

| Mechanism | Evidence |
|---|---|
| **Gasless 1Shot redemption** — `redeemDelegations` relayed, gas paid in USDC (EIP-7702) | [`0x26a4…40e9`](https://basescan.org/tx/0x26a44ffedefb113e6a6c1aa266985076684dea9faaea097f92e4f3e1731940e9) |
| **Real Venice inference, metered per-token** — paid draws against live AI | [`0x2557…43e9`](https://basescan.org/tx/0x2557becd49e3611b92ae089eb00d867672fcba4b61e2abfcbb6b98c010bc43e9) |

Testnet uses direct `redeemDelegations` (no bundler); mainnet settles through the 1Shot relayer (gas in USDC, no ETH float).

## Packages

Four building blocks, all **published to npm** (MIT). They split cleanly along the
protocol: a **buyer** mints commitments, a **seller** verifies and batch-redeems
them, **core** is the shared settlement + chain layer, and **splitter** is a
worked-example seller. Install what you need:

```bash
npm i @sip402/core @sip402/client @sip402/server @sip402/splitter
```

### Buyer — [`@sip402/client`](https://www.npmjs.com/package/@sip402/client) [![npm](https://img.shields.io/npm/v/@sip402/client.svg)](https://www.npmjs.com/package/@sip402/client)

Opens one capped, periodic payment session and issues a **commitment** per paid
request. The commitment *is* an ERC-7710 redelegation to the seller — so
agent-to-agent delegation is the payment primitive itself, not a side channel.
`openSession` (root periodic grant) · `redelegateSession` (A2A sub-budget) ·
`createCommitment` (redelegation-as-payment) · `revokeSession` (kill the chain
on-chain). [source](./packages/client)

### Seller — [`@sip402/server`](https://www.npmjs.com/package/@sip402/server) [![npm](https://img.shields.io/npm/v/@sip402/server.svg)](https://www.npmjs.com/package/@sip402/server)

Verifies each commitment by **simulating its redemption** — so an over-budget draw
is rejected because the chain reverts it, never because the server says so —
accumulates vouchers, and redeems **N of them in ONE `redeemDelegations`**.
`verifyCommitment` · `CommitmentAccumulator` (accept → batch-redeem) ·
`x402BatchSettlement` (Hono middleware) · `SettlementBus` / `sseHandler` (live
feed). [source](./packages/server)

### Settlement + chain — [`@sip402/core`](https://www.npmjs.com/package/@sip402/core) [![npm](https://img.shields.io/npm/v/@sip402/core.svg)](https://www.npmjs.com/package/@sip402/core)

The on-chain half both sides share. Network/USDC config (selected by
`SIP_NETWORK`), `SipMeter` off-chain accounting, and the **`Settler`** abstraction:
`createDirectRedeemSettler` (testnet, the delegate redeems directly) and
`createOneShotSettler` (mainnet, **gasless** via the 1Shot relayer, gas in USDC).
Both expose `settleBatch` — N commitments per tx, with an over-cap batch reverting
atomically (the "dry tab"). Includes the 1Shot JSON-RPC client. [source](./packages/core)

### Reference seller — [`@sip402/splitter`](https://www.npmjs.com/package/@sip402/splitter) [![npm](https://img.shields.io/npm/v/@sip402/splitter.svg)](https://www.npmjs.com/package/@sip402/splitter)

A worked example: resell **Venice AI** inference per token behind an
OpenAI-compatible gateway. `StreamingDrawer` fires on-chain draws as the response
streams; `veniceUpstream` (real Venice, mainnet) / `localUpstream` (deterministic,
testnet); `makeGateway` wraps any upstream with sip402 metering. [source](./packages/splitter)

### Apps (not published)

| App | Role |
|---|---|
| [`apps/site`](./apps/site) | Marketing site + docs — fully static, no backend, deploy anywhere. |
| [`apps/demo`](./apps/demo) | Local backend demo: guided Connect → Open → Run → Enforce with a real MetaMask ERC-7715 grant, batched draws, and on-chain cap revert — on **both** Base Sepolia and Base mainnet (gasless via 1Shot). See [its README](./apps/demo/README.md). |

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

# Marketing site (static — hero + docs)
pnpm --filter @sip402/site dev    # http://localhost:3400

# Local demo (backend: connect MetaMask, grant, batched draws, cap revert)
pnpm --filter @sip402/demo dev    # http://localhost:3402 — see apps/demo/README.md
```

The demo needs `apps/demo/.env` (gitignored): copy `apps/demo/.env.example` and set `PRIVATE_KEY` (a throwaway Base Sepolia wallet funded with a little ETH + test USDC). Default network is `base-sepolia`; set `SIP_NETWORK=base` for mainnet. Full walkthrough in [`apps/demo/README.md`](./apps/demo/README.md).

## Stack

MetaMask Smart Accounts Kit (ERC-7715 / ERC-7710) · 1Shot Permissionless Relayer (EIP-7702, gas in USDC, webhooks) · Venice AI (x402-metered) · Base.

## License

MIT
