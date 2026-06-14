# Live test: MetaMask ERC-7715 grant on the testnet "Open tab" flow

This wires a **real** MetaMask Advanced Permission (ERC-7715, `wallet_requestExecutionPermissions`)
into the testnet "Open tab" flow on **Base Sepolia (84532 / `0x14a34`)**. The agent then
spends the granted budget on-chain via real `redeemDelegations` transactions.

A human must approve the MetaMask popup — it cannot be automated.

## Prerequisites

- The demo must be on **testnet** (default). `GET /api/config` should return
  `{"isMainnet":false,"network":"base-sepolia"}`. (Do NOT set `SIP_NETWORK=base`.)
- `PRIVATE_KEY` (the funded owner EOA, `0xe576…F9c6`) must be in the environment so
  `/api/open` can gas-fund the ephemeral seller (the on-chain redeemer).
- Connect MetaMask (production, **not** Flask) with that funded account selected.
  It has ~11.59 test USDC + 0.14 ETH on Base Sepolia.
- Run the app: from repo root, `set -a; . ./.env; set +a` then `pnpm -C apps/demo dev`
  → open http://localhost:3402.

## What to click / what you should see

1. **Click "Open tab".**
   - Server generates a fresh **session keypair** (the delegate; private key stays server-side)
     plus an ephemeral **seller** EOA, and gas-funds the seller (one real Base Sepolia tx).
   - Status log: `Session keypair ready — session 0x…`.
   - An amber banner appears: *"Approve the ERC-7715 Advanced Permission in the MetaMask popup…"*.

2. **MetaMask connect + chain.**
   - If not connected, MetaMask asks to connect — approve.
   - If not on Base Sepolia, the app calls `wallet_switchEthereumChain` (and adds the chain
     if missing) — approve.

3. **MetaMask Advanced Permission popup.** This is the key step. MetaMask shows an
   ERC-7715 grant request:
   - Token: **USDC** (`0x036CbD…CF7e`)
   - Allowance: **2 USDC per day** (`erc20-token-periodic`, `periodDuration` 86400)
   - Spender / delegate: the **session address** from step 1
   - Justification: *"sip402: let this agent spend up to 2 USDC/day"*
   - Expiry: now + 7 days
   - **Approve it.**

4. **After approval:**
   - Status log: `Permission granted — context N bytes` then
     `Permission stored — agent can now spend within the 2 USDC/day cap`.
   - The banner turns green: **✅ Permission granted via MetaMask — agent may spend up to 2 USDC / day**.
   - The server logs `[/api/grant] stored MetaMask ERC-7715 grant: { … }`.
   - The **"Run cascade"** button becomes enabled (it is disabled until the grant is stored).

5. **Click "Run cascade".**
   - For each ~$0.05 batch the server:
     1. builds + **signs an open redelegation** (session → seller) from the granted
        permission context using the kit's `createx402DelegationProvider`, then
     2. has the **seller redeem** that context on-chain via `redeemDelegations`
        (the proven `createDirectRedeemSettler` flow) — a real Base Sepolia USDC transfer.
   - You should see several **settlement** rows in the Receipt Feed, each linking to a
     real `sepolia.basescan.org` tx. The "Total drawn" ticker climbs in $0.05 steps.
   - These transfers are drawn against the **MetaMask-granted** 2-USDC/day budget — verify on
     BaseScan that USDC leaves the granting smart account.

6. **Dry-tab (cap) behaviour.** The demo stops at 8 draws (~$0.40) for speed, but if you
   raise the draw count past the **2-USDC/day** grant, the next redemption **reverts on-chain**
   (the `ERC20PeriodTransferEnforcer` rejects it). The UI shows
   *"writer tab dry — granted budget exhausted or redemption reverted"* — the honest dry-tab demo.

7. **Revoke.** Click **Revoke** on the writer panel: the server drops the stored grant
   context so no further draws can be redeemed (status: *"granted budget disabled"*). To
   revoke the permission fully on-chain, revoke it from the MetaMask permissions UI.

## What to watch for during live testing (uncertainty)

- **The redemption path is the part that can only be confirmed live.** The granted `context`
  is redelegated (open delegation, `ANY_BENEFICIARY`) session → seller with a payee caveat =
  seller, then redeemed by the seller. If a redemption reverts *before* the cap, inspect the
  failing tx on BaseScan:
  - A `from`-mismatch would mean MetaMask's granted `from` (the smart account that actually
    holds the USDC) differs from what we passed — the server stores and forwards `grant.from`
    verbatim, so this should be correct, but confirm the USDC actually debits that account.
  - If the granting account is a **counterfactual** smart account not yet deployed, the run
    forwards the grant's `dependencies` (factory/factoryData) and the seller deploys it once
    before the first redeem (status: *"Deploying granting smart account … before first redeem"*).
    If a draw still reverts with a "no code"/factory error after that, the dependency deploy
    didn't land — capture the dependency-deploy tx hash and revert reason.
  - The seller must have ETH for gas (auto-funded in `/api/open`); a gas revert is unrelated to
    the grant.
- Everything except the live MetaMask popup + on-chain redemption was verified:
  build, `pnpm -r typecheck`, `/api/open` returns a `sessionAddress`, `/api/grant` stores the
  context, and `/api/config` reports testnet.
