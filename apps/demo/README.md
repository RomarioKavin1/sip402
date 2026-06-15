# sip402 demo (local)

The interactive **Grant → Spend → Enforce** dashboard. Unlike the marketing site
(`apps/site`, fully static), this app has a backend: it generates session keys,
funds them, and submits **real transactions**, so it needs a funded key and an
RPC and runs on your machine.

What you'll see: connect MetaMask, approve **one** ERC-7715 Advanced Permission
(a 0.30 USDC/day cap), then watch an agent sip USDC against it. The over-cap draw
**reverts on-chain**, and revoking an agent halts it mid-stream. No custodian
ever holds the funds.

---

## Prerequisites

- **Node 20+** and **pnpm 9+** (`npm i -g pnpm`).
- **MetaMask** with Advanced Permissions (ERC-7715) support. The grant uses
  `wallet_requestExecutionPermissions`; use a build of MetaMask that supports it
  (MetaMask Flask, or a release with the Delegation/Advanced Permissions feature).
- A **throwaway private key** funded on **Base Sepolia** with **Sepolia ETH only**
  (it pays gas, not USDC). Budget **~0.01 ETH per run** — each _Open_ gas-funds a
  fresh session + seller EOA with 0.008 ETH; **~0.03 ETH** gives you a few runs.
  Faucet: <https://www.alchemy.com/faucets/base-sepolia>. This key funds the session
  and seller server-side. Never use a key with real funds.
- The **MetaMask account you sign the grant with** needs **test USDC** — the draws
  pull from *its* granted budget, not the throwaway key. USDC at
  `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Circle faucet: <https://faucet.circle.com>).

---

## Setup

```bash
# from the repo root
git clone https://github.com/RomarioKavin1/sip402
cd sip402
pnpm install

# configure the demo backend
cp apps/demo/.env.example apps/demo/.env
```

Edit `apps/demo/.env`:

```bash
PRIVATE_KEY=0x...                              # your funded Base Sepolia key
SIP_NETWORK=base-sepolia
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org  # public default is fine
```

---

## Run

```bash
pnpm --filter @sip402/demo dev
# → http://localhost:3402
```

(From inside `apps/demo` you can also just run `pnpm dev`.)

---

## The flow (what the four steps do)

1. **Connect wallet** — connects MetaMask and switches it to Base Sepolia.
2. **Open tab** — the server mints a fresh **session keypair** and funds it, then
   MetaMask pops up for **one** ERC-7715 `erc20-token-periodic` permission: up to
   **0.30 USDC/day** to that session. Approving it stores the grant server-side as
   the session root. This is the only signature you give.
3. **Run** — the agent sips USDC per request. Each draw is a real
   `redeemDelegations` settlement against the granted permission; the ticker
   climbs and each receipt links to Basescan.
4. **Enforce** — when cumulative draws pass the cap, the next draw **reverts**
   (`ERC20PeriodTransferEnforcer:transfer-amount-exceeded`) — the "dry tab". Hit
   **Revoke** on an agent and `disableDelegation` stops its next draw mid-stream.

Use **Show details** for the delegation tree, the full receipt feed, and the
status log.

---

## How it's wired

- `app/api/open` — generates the session + seller keypairs and gas-funds the
  session EOA (so the first draw doesn't lose an RPC-lag race).
- `app/api/grant` — stores the MetaMask-signed ERC-7715 permission context as the
  session root.
- `app/api/run` — drives the draws. On testnet it redeems the granted permission
  directly (no bundler); on mainnet it streams real Venice inference and settles
  via the gasless 1Shot relayer (`@sip402/splitter` + `@sip402/core`).
- `app/api/revoke` — `disableDelegation` on an agent's leaf.
- `app/api/events` — Server-Sent Events feeding the ticker, receipts, and stream.

Backed by the published packages: `@sip402/core`, `@sip402/client`,
`@sip402/server`, `@sip402/splitter`.

---

## Mainnet (optional)

Mainnet settlement (gasless 1Shot redemption + paid Venice inference) is proven
on Base and runnable here by setting `SIP_NETWORK=base` plus `BASE_RPC_URL` and a
funded mainnet key with a prepaid Venice balance. It uses a server-side agent
(no MetaMask popup) and **spends real USDC** — leave it on `base-sepolia` for the
interactive demo.

---

## Troubleshooting

- **"MetaMask not detected"** — install/enable MetaMask; reload the tab.
- **No MetaMask popup on Open tab** — your MetaMask build may lack ERC-7715
  support; use MetaMask Flask or a release with Advanced Permissions.
- **`gas required exceeds allowance (0)`** — the session EOA wasn't funded; check
  `PRIVATE_KEY` has Base Sepolia ETH and the RPC is reachable.
- **Draws never revert** — the cap is 0.30 USDC/day per agent; if you re-run
  within the same period the remaining budget is lower, which is expected.
- **Module/build cache errors** — stop the dev server, `rm -rf apps/demo/.next`,
  restart. Don't run a production `build` against a live dev server's `.next`.
