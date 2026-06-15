# @sip402/client

[![npm](https://img.shields.io/npm/v/@sip402/client.svg)](https://www.npmjs.com/package/@sip402/client) · [repo](https://github.com/RomarioKavin1/sip402) · [SPEC](https://github.com/RomarioKavin1/sip402/blob/main/SPEC.md)

The **buyer side** of sip402. A buyer opens one capped, periodic payment session, then — for each paid request — issues a **commitment**, which *is* an ERC-7710 redelegation to the seller. The seller batches and redeems those commitments (see [`@sip402/server`](https://www.npmjs.com/package/@sip402/server)). The payment is the delegation.

```bash
npm i @sip402/client
```

## The buyer lifecycle

| Function | What it does |
|---|---|
| `openSession()` | Grant the **root** periodic delegation: treasury smart account → agent key, capped per period (`ERC20PeriodTransferEnforcer`). |
| `redelegateSession()` | **A2A**: narrow a scoped sub-budget to a fresh specialist agent — one more hop on the delegation chain. |
| `createCommitment()` | The x402 **payment**: a redelegation agent → seller for exactly this request's amount. Off-chain to mint; redeemed on-chain by the seller. |
| `revokeSession()` | Disable the root delegation on-chain — cancels every chain derived from it. |

## Usage

```ts
import { openSession, createCommitment, revokeSession } from "@sip402/client";
import { toUsdcAtoms } from "@sip402/core";

// 1. Open a standing session: up to $1.00 / day, drawn by the agent key.
const session = await openSession({
  ownerPrivateKey: OWNER_KEY,
  capUsd: 1,
  periodSeconds: 86_400,
});

// 2. For each paid request, mint a commitment (a redelegation → the seller).
const commitment = await createCommitment({
  session,
  sellerAddress: SELLER,
  amountAtoms: toUsdcAtoms("0.04"),
});
// → hand `commitment` to the seller as the x402 payment; it serves, then batch-redeems.

// 3. Cancel everything, on-chain, at any time.
await revokeSession({ session, ownerPrivateKey: OWNER_KEY });
```

A `Commitment` is a signed voucher; nothing moves until the seller redeems it. Because each commitment is a redelegation, agent-to-agent delegation **is** the payment primitive — the same object expresses authority and value.

## Related

- [`@sip402/core`](https://www.npmjs.com/package/@sip402/core) — settlement + chain config (the seller half).
- [`@sip402/server`](https://www.npmjs.com/package/@sip402/server) — verify, accumulate, batch-redeem + x402 middleware.

## License

MIT
