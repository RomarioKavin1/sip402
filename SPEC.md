# sip402 — ERC-7710 capital-backed network binding for x402 `batch-settlement`

**Status:** Draft / reference implementation
**Scheme:** `batch-settlement` (see [x402 spec](https://github.com/coinbase/x402/blob/main/specs/schemes/batch-settlement/batch_settlement.md))
**Networks:** `eip155:8453` (Base mainnet), `eip155:84532` (Base Sepolia)
**Trust model:** Capital-backed
**Asset:** USDC (ERC-20), atomic units (6 decimals)

---

## 1. Motivation

x402's `exact` and `upto` schemes settle **immediately, per request** — one signed authorization, one on-chain transfer. They cannot express a *standing relationship* in which an agent makes many small, variable-cost calls and value settles in batches.

x402's `batch-settlement` scheme exists for exactly this ("commit now, settle later"), but it is **abstract**: its only concrete binding is `cloudflare:402`, which is **credit-backed** (a network intermediary underwrites access and invoices a billing identity off-chain in fiat). There is **no on-chain, capital-backed binding** — no way for an agent to back its commitments with its *own* funds under cryptographic, self-custodial control.

sip402 is that binding. The buyer grants a bounded, periodic **ERC-7710 delegation**; each request is paid with a **redelegation to the seller** (the commitment); the seller accumulates commitments and **redeems them in batches** through the MetaMask Delegation Manager. The buyer's funds never leave their account until redemption, spending is capped on-chain by the delegation's caveats, and the buyer can revoke at any time — enforced by the chain, not by any intermediary.

## 2. Roles

- **Buyer** — an agent (or its owner's treasury smart account) that holds USDC and grants spending authority. The trust anchor.
- **Seller (resource server)** — serves a paid resource; accumulates commitments; redeems batches. In the reference implementation this is `@sip402/splitter`, reselling Venice AI inference.
- **Delegation Manager** — the on-chain ERC-7710 component that validates delegation chains and executes redemptions (MetaMask Smart Accounts Kit). Plays the role x402 calls the *settlement rail*.
- **Relayer (optional)** — on mainnet, the 1Shot Permissionless Relayer submits redemptions gaslessly (fee paid in USDC). On testnet the seller submits redemptions directly.

## 3. The session

A **session** is a periodic ERC-7710 delegation created with the `ScopeType.Erc20PeriodTransfer` scope:

```
scope: { type: Erc20PeriodTransfer, tokenAddress: USDC, periodAmount: cap, periodDuration, startDate }
```

The `ERC20PeriodTransferEnforcer` caveat enforces, on-chain, that the cumulative amount transferred via this delegation within any period never exceeds `periodAmount`; the over-cap redemption reverts. This is the session's hard spending ceiling. The delegation may be **redelegated** (attenuated) to sub-agents (A2A): `user → orchestrator → specialist`, each child's cap ≤ its parent's.

## 4. The commitment = a redelegation to the seller

When the buyer pays for a request, the `PaymentPayload.payload` is a **signed redelegation** that extends the buyer's delegation chain to the seller, scoped to this request's amount:

```jsonc
{
  "scheme": "batch-settlement",
  "network": "eip155:8453",
  "payload": {
    "delegationManager": "0x...",        // ERC-7710 Delegation Manager address
    "permissionContext": "0x...",         // ABI-encoded signed delegation chain, leaf = seller
    "delegator": "0x...",                 // buyer treasury (root delegator)
    "amount": "250000",                   // atomic USDC authorized for this commitment
    "nonce": "0x...",                     // unique per commitment (replay prevention)
    "validBefore": "1750000000"           // commitment expiry (unix seconds)
  }
}
```

Because the commitment is itself a delegation chain whose leaf authorizes the seller, the seller can redeem it **without trusting the buyer** to act later. The on-chain caveats bound what any redemption can do.

## 5. Lifecycle (the three batch-settlement phases)

### 5.1 Commit
1. Buyer requests a resource. Seller responds `402` with `PAYMENT-REQUIRED` advertising `scheme: "batch-settlement"`, `network`, `asset: USDC`, `payTo: <seller>`, and the per-call `amount` (or a price quote).
2. Buyer constructs the commitment (§4): a redelegation to the seller for `amount`, signed against its periodic delegation, and returns it in the `PAYMENT-SIGNATURE` header.
3. Seller **verifies** (§6). On success it **serves the resource immediately** and returns a `PAYMENT-RESPONSE` whose settlement result carries a **commitment identifier** (the voucher hash) — *not* a transaction hash, because value has not yet moved.

### 5.2 Accumulate
The seller stores accepted commitments in a voucher store, tracking the cumulative authorized amount against the session's remaining on-chain budget. The binding allows the seller to choose its redemption cadence: per fixed micro-batch (e.g. every `minBatchAtoms`), per N requests, on a timer, or at session end.

### 5.3 Redeem
The seller redeems accumulated commitments through the Delegation Manager:

```
DelegationManager.redeemDelegations({
  delegations: [[ ...chain ]],          // the buyer→…→seller chain from permissionContext
  modes:       [ SingleDefault ],
  executions:  [[ transfer(seller, batchAmount) ]]
})
```

- **Testnet (`eip155:84532`):** the seller submits this as a normal transaction (pays gas in ETH).
- **Mainnet (`eip155:8453`):** the seller submits via the 1Shot relayer (`relayer_send7710Transaction`); gas is paid in USDC out of the same flow, no ETH float. Webhooks report terminal status.

The `ERC20PeriodTransferEnforcer` caps the batch; an over-budget redemption reverts atomically (no partial settlement). On success the seller emits a settlement record linking the batch transaction hash to the commitment identifiers it covered.

## 6. Verification rules (seller)

For each commitment the seller MUST verify:
1. The delegation chain in `permissionContext` is well-formed and signatures are valid up to the root `delegator`.
2. The leaf authorizes **this seller** (`payTo`) to redeem.
3. `amount + alreadyAuthorizedThisPeriod ≤ remainingPeriodBudget`, where `remainingPeriodBudget` is read on-chain via `getErc20PeriodTransferEnforcerAvailableAmount`.
4. `nonce` has not been seen before (replay prevention).
5. `validBefore` is in the future and within the delegation's period window.
6. The delegation is not disabled (a `disableDelegation` would make redemption revert; the seller SHOULD treat a revoked session as terminal).

A commitment failing any check is rejected with the appropriate x402 error; the resource is not served.

## 7. Double-spend prevention

Two independent layers:
- **Off-chain:** per-commitment `nonce`, tracked in the seller's voucher store; a nonce is accepted at most once.
- **On-chain:** the `ERC20PeriodTransferEnforcer` tracks cumulative redeemed value per period and reverts any redemption that would exceed `periodAmount`, regardless of how many commitments the seller submits. This is the authoritative ceiling.

## 8. Settlement guarantee & seller risk

The seller's guarantee is **capital-backed**: any accepted commitment is redeemable up to the on-chain remaining budget, which the seller checks before serving. The seller's only exposure is value **delivered but not yet redeemed** between batches; bounding the batch size (e.g. `minBatchAtoms`) bounds this exposure to at most one batch. The buyer's exposure is bounded by `periodAmount` and revocable at any time. No intermediary underwrites either side.

## 9. Commitment & settlement identifiers

- **Commitment identifier** (returned at Commit): `keccak256` of the canonical commitment fields (the voucher hash). Non-empty on success, per the `batch-settlement` requirement.
- **Settlement record** (emitted at Redeem): `{ batchTxHash, network, commitmentIds: [...], amount }`. Optionally signed using the x402 **offer-and-receipt** extension to produce dispute-grade, reputation-usable receipts.

## 10. Reference implementation

| Package | Role |
|---|---|
| `@sip402/core` | Chain config, `SipMeter` (accumulation accounting), `Settler` (Redeem rail: `DirectRedeemSettler` testnet / `OneShotSettler` mainnet via 1Shot), 1Shot client. |
| `@sip402/client` | Buyer side: `openSession` (periodic delegation), `redelegateSession` (A2A attenuation), `createCommitment` (redelegation-to-seller voucher), `revokeSession`. |
| `@sip402/server` | Seller side: `402` challenge, commitment verification, voucher accumulation, batch redemption, x402 HTTP headers, signed receipts. |
| `@sip402/splitter` | Reference seller reselling Venice AI inference, billed per token via batched commitments. |

The core `redeemDelegations` redemption is proven on Base Sepolia (see `packages/core/scripts/rail-proof.ts`): a periodic delegation, cumulative draws, and an over-cap revert, all as real on-chain transactions.

## 11. Relationship to other x402 schemes

- **`exact`** — immediate, fixed amount, settled once. sip402 defers and batches.
- **`upto`** — immediate, variable amount up to a max, settled **once** ("each authorization MUST be settled at most once"). sip402 settles **many** times against one standing authorization, bounded by an on-chain period caveat, and never requires the buyer to trust the seller's metering (the cap is enforced on-chain, not asserted by the server).
- **`batch-settlement` / `cloudflare:402`** — credit-backed, fiat, off-chain, network-as-merchant-of-record. sip402 is the capital-backed, on-chain, self-custodial counterpart of the same scheme.
