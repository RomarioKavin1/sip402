# PRODUCT.md — sip402

**register:** hybrid. The marketing surfaces (hero `/`, docs `/docs`) are **brand**. The live dashboard (`/dashboard`) is **product**.

## What it is
sip402 — **"x402's payment stream is centralised. sip402 decentralises it."** x402 describes a `batch-settlement` scheme for streaming, session-based payments, but its only shipped binding (`cloudflare:402`) is centralised: credit-backed, off-chain, network-as-merchant. sip402 is the first **on-chain, self-custodial** binding of the same scheme. One MetaMask ERC-7715 Advanced Permission grants a capped, periodic USDC allowance; an agent spends within it; the **chain** enforces the cap and revocation; settlement is gasless via 1Shot. No trusted custodian.

## Users
Crypto-native developers, agent builders, and hackathon judges evaluating an agent-payments protocol. They are technical, skeptical of hand-waving, and reward proof (real on-chain transactions) over claims.

## Brand voice (three physical words)
**Clean. Confident. Merchandised.** A hardware merchandiser's poise: stark white canvas, tight type hierarchy, big soft-rounded cards, pill CTAs. Black pills sell the idea; one cobalt pill closes the deal.

## Strategic principles
- **Proof over pitch.** Every claim links to a real Basescan transaction. The hero's credibility comes from "here is the tx," not adjectives.
- **The one idea:** x402's streaming `batch-settlement` only shipped as a *centralised*, off-chain binding (`cloudflare:402`); sip402 is the *decentralised, on-chain, self-custodial* one. Kicker: *x402 prices the request; sip402 prices the delivery.*
- **Make the judge understand in 10 seconds:** Grant → Spend → Enforce. The dashboard must narrate this, not present raw mechanics.
- **Answer "isn't it supposed to be on-chain?"** explicitly: money + limits + revocation are on-chain (no custodian); the resource server (HTTP/AI) is off-chain by necessity.

## Anti-references (do NOT look like these)
- Crypto neon-on-black (the first reflex). No electric cyan/green glow.
- Terminal-green dark mode (the second reflex).
- Editorial-magazine (display-serif + italic + ruled columns).
- Generic SaaS hero-metric template (big number + 3 supporting stats + gradient accent).

## Aesthetic lane (named)
Meta commerce. Stark white canvas, Optimistic-VF-style Inter (weight 500 display + ss01/ss02), a two-tier CTA system (black pills on marketing, one cobalt pill in the demo's buy-flow), ghost-outline secondary, big soft-rounded white cards with hairline borders, flat by default. See DESIGN.md for the full system.
