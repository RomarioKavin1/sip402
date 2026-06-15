# Builder feedback

Honest, specific feedback on the three sponsor stacks, from actually shipping
**sip402** — an on-chain binding of x402 `batch-settlement` — end to end on Base
mainnet during this hackathon. Written to be useful, not to flatter: the wins are
real and so is the friction.

---

## MetaMask Smart Accounts Kit (ERC-7715 / ERC-7710)

**What worked well**
- `erc20-token-periodic` + the `ERC20PeriodTransferEnforcer` is *exactly* the right
  primitive for a capped, standing spend session. "One grant, a daily cap the chain
  enforces" fell out naturally — no custom contracts.
- **Batched `redeemDelegations`** with parallel `delegations[] / modes[] / executions[]`
  is the whole reason sip402's batch-settlement works: N commitments, one tx, and an
  over-cap batch reverts atomically. This is a genuinely powerful, underused capability.
- **Verify-by-simulation** (simulate the redemption to accept/reject a commitment) let
  the seller trust the chain instead of the buyer's metering. Clean mental model.
- `toMetaMaskSmartAccount` + `Stateless7702` made the EOA-as-delegator path painless.

**Friction / rough edges**
- **Encoded `Hex` context vs decoded `Delegation` objects.** A MetaMask grant returns
  an encoded `permissionContext` (Hex), but redeeming it through a relayer needs
  `Delegation` *objects*. We only found `decodeDelegations` after a while — the
  Hex↔objects round-trip should be front-and-centre in the docs.
- **Redelegating a grant to a specific redeemer.** Getting a grant to be redeemable by
  a relayer required `redelegatePermissionContext` with `to: <target>` — the *open*
  variant set the delegate to the `ANY_DELEGATE` sentinel and the relayer rejected it.
  The "the redeemer must be the first delegation's delegate" rule wasn't obvious.
- **Bundled viem types.** The kit ships its own viem types that differ structurally from
  the app's, so clients need an `as any` cast even though they're runtime-compatible.
- **Counterfactual deploy dependencies.** Needing to land the granting smart account's
  `dependencies` before the first redeem (or the first redemption reverts with "no code")
  is easy to miss.

**Suggestions:** a worked example of "feed a granted context into a third-party relayer";
a helper for `Hex context ↔ RelayerDelegation[]`; and a short doc on the redelegate-to-
redeemer requirement.

---

## 1Shot Permissionless Relayer

**What worked well**
- **`send7710Transaction` merges multiple delegated transactions into ONE
  `redeemDelegations`** — this is what made gasless *batch*-settlement possible on
  mainnet, with a flat relayer fee per batch (not per draw).
- **`estimate7710Transaction` is read-only and prices the exact bundle.** This was the
  single most valuable thing for us: we validated the entire mainnet batch + cap-revert
  path (under-cap prices, over-cap rejects with `transfer-amount-exceeded`) for **$0**
  before ever spending. Estimate-before-send also means a malformed bundle fails free.
- Gasless via EIP-7702 with the fee paid in USDC, no ETH float — perfect for agents.

**Friction / rough edges**
- The **"first delegation's delegate must be the relayer Target wallet"** validation
  error was the hardest thing to debug — it's only discoverable by calling
  `getCapabilities` and matching `targetAddress`. Surfacing this requirement in the
  docs (and the error) would save hours.
- `permissionContext` expects relayer-JSON `Delegation` objects, not the encoded Hex you
  get from a MetaMask grant — see the kit note above; the two stacks meet awkwardly here.
- **Mainnet-only.** With no testnet relayer, every real iteration costs USDC. The
  estimate endpoint saved us, but a sandbox/testnet relayer would massively lower the
  bar for hackathon iteration.

**Suggestions:** document the target-delegate rule + the estimate-first workflow
prominently; expose a testnet relayer.

---

## Venice AI

**What worked well**
- **x402-native**: pay-per-call in USDC with no API key to manage. `venice-x402-client`
  made the integration a near one-liner (`veniceUpstream(privateKey)` → streamed tokens).
- **OpenAI-compatible** request/response, so wrapping it behind a metered gateway was trivial.
- Real inference, real per-token cost — the demo's "the agent is buying live AI and paying
  as it streams" is true, not staged.

**Friction / rough edges**
- **Mainnet-only / no free tier.** Every test draws real USDC, so iterating on the
  Venice path costs money. A small free quota or a sandbox would help a lot for hackathons.
- `autoTopUp` defaults and balance behaviour took a beat to understand.

**Suggestions:** a testnet/sandbox or a tiny free hackathon quota.

---

## Cross-cutting (Base / infra)

- The **public Base RPC throttles in-flight txs for 7702-delegated accounts**
  (`in-flight transaction limit reached for delegated accounts`). Since 1Shot leaves
  the owner EOA 7702-delegated, rapid funding/redeem txs against the public RPC fail
  intermittently. Worth documenting; in practice you want a dedicated RPC for any demo
  that fires several txs quickly.

Overall: the three stacks compose into something that genuinely didn't exist before — a
gasless, on-chain, self-custodial streaming-payment session. The friction above is mostly
**documentation and a missing testnet rail**, not missing capability.
