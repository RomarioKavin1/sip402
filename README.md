# sip402

**Session-Initiated Payments — open a tab, pay by the sip.**

sip402 turns a single MetaMask permission into a *standing, revocable payment session*. An agent opens a tab once, then "sips" tiny USDC draws against it as a paid AI stream is delivered — settled mid-stream through the 1Shot relayer, capped on-chain by ERC-7710 caveats, and cancellable mid-sentence. It's the thing x402's existing schemes structurally can't do: **x402 prices the request; sip402 prices the delivery.**

## Why

Every AI service prices by the token, but every crypto-AI payment scheme prices a fixed amount decided *before* delivery. The `exact` scheme is one-shot; the `upto` scheme settles once, after full delivery, and asks you to trust the server not to overcharge; prepaid balances lock a per-provider minimum. Nothing meters a *standing relationship* — many requests, paid in batches as they stream, exposure bounded to one batch, shut off mid-stream with on-chain enforcement.

ERC-7710 delegation is the only x402 payment method marked **multi-use** in the spec — implemented by no shipping product. sip402 switches it on.

## Packages

- `@sip402/client` — extends the official `@metamask/x402` buyer: open a session, sip accounting, "session-required" 402 handling.
- `@sip402/server` — seller middleware: meter delivery, batched-draw engine, dry-session halting, verify-by-simulation; settles through 1Shot (no ETH float, no custody).
- `@sip402/splitter` — demo seller: one shared Venice AI balance, OpenAI-compatible gateway, per-agent on-chain budgets.
- `apps/demo` — "Two agents, one tab": live delegation tree, per-token USDC ticker, receipt feed, revoke.

## Stack

MetaMask Smart Accounts Kit (ERC-7715 / ERC-7710) · 1Shot Permissionless Relayer (EIP-7702, gas in USDC, webhooks) · Venice AI (x402-metered text + images) · Base mainnet.

## Status

Work in progress.
