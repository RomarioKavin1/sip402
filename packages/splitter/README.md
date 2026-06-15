# @sip402/splitter

[![npm](https://img.shields.io/npm/v/@sip402/splitter.svg)](https://www.npmjs.com/package/@sip402/splitter) · [repo](https://github.com/RomarioKavin1/sip402) · [SPEC](https://github.com/RomarioKavin1/sip402/blob/main/SPEC.md)

A **reference seller** built on sip402: resell **Venice AI** inference behind an OpenAI-compatible gateway, billed **per token** as a paid stream — draws settle on-chain in batches while the response streams. Shows the full seller loop end to end.

```bash
npm i @sip402/splitter
```

## What's inside

| Export | Purpose |
|---|---|
| `veniceUpstream(privateKey)` / `localUpstream()` | The AI upstream. `veniceUpstream` is real Venice via x402 (Base mainnet only); `localUpstream` is a deterministic generator for testnet/dev. |
| `tokenCostAtoms()`, `USDC_PER_1K_TOKENS`, `ATOMS_PER_TOKEN` | Per-token USDC pricing (integer atoms, ceil-rounded). |
| `StreamingDrawer` | Accrue token costs and fire an on-chain draw each time the batch threshold is crossed; `DryTabError` when the cap is hit. |
| `makeGateway()` | A Hono app that wraps an upstream with sip402 metering + a settlement bus + the seller address. |

## Stream + draw

```ts
import { StreamingDrawer, veniceUpstream, localUpstream, tokenCostAtoms } from "@sip402/splitter";

const drawer = new StreamingDrawer({ sellerPrivateKey, commitment, minBatchAtoms, onEvent });
const up = IS_MAINNET ? veniceUpstream(PRIVATE_KEY) : localUpstream();

for await (const chunk of up.chatStream({ model: "llama-3.3-70b", messages })) {
  process.stdout.write(chunk.text);
  await drawer.record(tokenCostAtoms(chunk.tokens)); // draws on-chain at each threshold
}
await drawer.finalize(); // flush the remainder; throws DryTabError if the cap is dry
```

## OpenAI-compatible gateway

```ts
import { serve } from "@hono/node-server";
import { makeGateway, veniceUpstream } from "@sip402/splitter";

const { app, bus, sellerAddress } = makeGateway({
  sellerPrivateKey: SELLER_KEY,
  upstream: veniceUpstream(PRIVATE_KEY),
  minBatchAtoms: toUsdcAtoms("0.25"),
});
serve(app); // POST /v1/chat/completions — pay-per-token over sip402
```

## Related

- [`@sip402/server`](https://www.npmjs.com/package/@sip402/server) — the verify/accumulate/batch-redeem engine it builds on.
- [`@sip402/core`](https://www.npmjs.com/package/@sip402/core) · [`@sip402/client`](https://www.npmjs.com/package/@sip402/client)

## License

MIT
