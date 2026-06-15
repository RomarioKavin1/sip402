# @sip402/server

[![npm](https://img.shields.io/npm/v/@sip402/server.svg)](https://www.npmjs.com/package/@sip402/server) · [repo](https://github.com/RomarioKavin1/sip402) · [SPEC](https://github.com/RomarioKavin1/sip402/blob/main/SPEC.md)

The **seller side** of the sip402 x402 `batch-settlement` binding. Verify incoming commitments by **simulation**, **accumulate** them, and **batch-redeem** — N commitments in ONE `redeemDelegations` transaction. Ships with x402 HTTP middleware and a settlement event feed.

```bash
npm i @sip402/server
```

## What's inside

| Export | Purpose |
|---|---|
| `verifyCommitment()` / `simulateRedeem()` | Accept a commitment only if its redemption **simulates successfully** (SPEC §6) — no trust in the buyer's metering. |
| `CommitmentAccumulator` | Accept (verify) + accumulate vouchers; `flush()` redeems ALL pending in **one batch tx** (SPEC §5.2–5.3). |
| `x402BatchSettlement()` | Hono middleware: 402-challenge with the offer, accept the `batch-settlement` payment, serve, settle. |
| `SettlementBus`, `sseHandler`, `webhookHandler` | Subscribe to settlement events (SSE for dashboards; webhook for the 1Shot relayer's async status). |

## Verify → accumulate → batch-redeem

```ts
import { CommitmentAccumulator } from "@sip402/server";

const acc = new CommitmentAccumulator({
  sellerPrivateKey: SELLER_KEY,
  expectedPayTo: SELLER_ADDRESS,
  minBatchAtoms: toUsdcAtoms("0.25"),   // flush threshold
  onEvent: (e) => console.log("settled", e.txHash, e.amountAtoms),
});

// Each request: verify-by-simulation, store, auto-flush once the threshold is crossed.
const { commitmentId, settleTxHash } = await acc.recordAndMaybeFlush(commitment);

// …or flush explicitly — redeems EVERY pending commitment in ONE redeemDelegations.
const txHash = await acc.flush();
```

Over-budget commitments are rejected at `accept()` because the redeem **simulation reverts** (`ERC20PeriodTransferEnforcer:transfer-amount-exceeded`) — the cap is enforced on-chain, never asserted by the server.

## x402 middleware

```ts
import { Hono } from "hono";
import { x402BatchSettlement, CommitmentAccumulator } from "@sip402/server";

const app = new Hono();
app.use("/paid/*", x402BatchSettlement({
  price: () => toUsdcAtoms("0.04"),
  payTo: SELLER_ADDRESS,
  accumulator: acc,
}));
```

## Related

- [`@sip402/core`](https://www.npmjs.com/package/@sip402/core) — the `Settler` + chain config it redeems through.
- [`@sip402/client`](https://www.npmjs.com/package/@sip402/client) — the buyer that mints the commitments.
- [`@sip402/splitter`](https://www.npmjs.com/package/@sip402/splitter) — a reference seller reselling Venice AI.

## License

MIT
