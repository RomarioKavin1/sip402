# @sip402/core

[![npm](https://img.shields.io/npm/v/@sip402/core.svg)](https://www.npmjs.com/package/@sip402/core) · [repo](https://github.com/RomarioKavin1/sip402) · [SPEC](https://github.com/RomarioKavin1/sip402/blob/main/SPEC.md)

The on-chain / settlement half of **sip402** — the capital-backed, ERC-7710 binding of x402's `batch-settlement` scheme. This package holds the pieces both the seller and the demo need: network config, off-chain draw accounting, the **Settler** that redeems commitments, and the **1Shot** gasless-relayer client.

```bash
npm i @sip402/core
```

## What's inside

| Module | Exports | Purpose |
|---|---|---|
| `chain` | `SIP_NETWORK`, `IS_MAINNET`, `CHAIN`, `CHAIN_ID`, `USDC`, `toUsdcAtoms()` | Network + USDC config, selected once from `SIP_NETWORK` (`base` \| `base-sepolia`). |
| `session` | `SipMeter` | Pure, off-chain mirror of the on-chain period cap — accrues token costs and decides when to draw. |
| `settle` | `Settler`, `createDirectRedeemSettler()`, `createOneShotSettler()`, `buildTransferExecution()` | Redeem one commitment (`settle`) or **N in one `redeemDelegations`** (`settleBatch`). |
| `oneshot` | `getCapabilities()`, `estimate7710Transaction()`, `send7710Transaction()`, `pollUntilTerminal()` | JSON-RPC client for the **1Shot** permissionless relayer (gasless, gas paid in USDC, EIP-7702). |

## The two settlers

Both implement the same `Settler` interface; pick by network.

```ts
import { createDirectRedeemSettler, createOneShotSettler, toUsdcAtoms } from "@sip402/core";
import { privateKeyToAccount } from "viem/accounts";

// TESTNET — the delegate EOA redeems directly through the Delegation Manager (pays gas).
const settler = createDirectRedeemSettler({ delegateAccount: privateKeyToAccount(SESSION_KEY) });

// MAINNET — gasless: the 1Shot relayer redeems and takes its fee in USDC (EIP-7702).
const settler = createOneShotSettler({ ownerAccount: privateKeyToAccount(OWNER_KEY) });

// Settle ONE sip…
await settler.settle({ signedDelegation, payTo: SELLER, atoms: toUsdcAtoms("0.04") });

// …or BATCH many commitments into ONE redeemDelegations (the batch-settlement scheme).
// The on-chain period enforcer accumulates across the batch, so an over-cap batch
// reverts atomically — the "dry tab".
const { txHash, count, totalAtoms } = await settler.settleBatch({
  signedDelegation,
  payTo: SELLER,
  atomsList: [toUsdcAtoms("0.04"), toUsdcAtoms("0.04"), toUsdcAtoms("0.04")],
});
```

## SipMeter — off-chain accounting

`SipMeter` tracks cumulative draws against a session cap so the seller knows when to flush a batch, without a chain round-trip per token. The on-chain `ERC20PeriodTransferEnforcer` is the source of truth; `SipMeter` is its fast, local mirror.

## Configuration

`SIP_NETWORK` selects the network at module load (`base-sepolia` by default). `BASE_RPC_URL` / `BASE_SEPOLIA_RPC_URL` override the RPC; the 1Shot relayer URL and target/fee addresses are wired automatically per network.

## License

MIT
