/**
 * sip402 RAIL PROOF — Base Sepolia, real transactions, NO bundler / NO relayer.
 *
 * Proves the core sip402 payment mechanism end-to-end on a live testnet:
 *   - ONE ERC-7710 periodic spend delegation (ScopeType.Erc20PeriodTransfer, $1/day USDC cap)
 *   - MANY small "draws" (sips) redeemed against it, settled on-chain, drawing cumulatively
 *   - the over-cap draw REVERTS (the "dry tab")
 *
 * ============================================================================
 * KIT SYMBOLS USED (the critical Task 1.3 discovery — documented for later tasks)
 * ============================================================================
 *
 * DEPLOY a counterfactual MetaMask smart account WITHOUT a bundler:
 *   const account = await toMetaMaskSmartAccount({
 *     client, implementation: Implementation.Hybrid,
 *     deployParams: [ownerEoa, [], [], []],   // Hybrid: [owner, p256KeyIds, p256X, p256Y]
 *     deploySalt: "0x...", signer: { account: ownerEoa },
 *   });
 *   const { factory, factoryData } = await account.getFactoryArgs();
 *   // send a PLAIN tx from a funded EOA — this deploys the account via SimpleFactory:
 *   await ownerWallet.sendTransaction({ to: factory, data: factoryData });
 *   // verify with contracts.isContractDeployed({ client, contractAddress: account.address })
 *
 * SIGN the delegation (treasury / delegator smart account signs over EIP-712):
 *   const delegation = createDelegation({
 *     scope: { type: ScopeType.Erc20PeriodTransfer, tokenAddress, periodAmount,
 *              periodDuration, startDate },
 *     to: delegateEoa.address, from: treasury.address, environment: treasury.environment });
 *   const signature = await treasury.signDelegation({ delegation });
 *   const signed = { ...delegation, signature };
 *
 * REDEEM as a plain EOA delegate WITHOUT a bundler (the redeemer path):
 *   import { contracts, createExecution, ExecutionMode, getSmartAccountsEnvironment } from "@metamask/smart-accounts-kit";
 *   const execution = createExecution({ target: USDC, value: 0n, callData: transferCalldata });
 *   const data = contracts.DelegationManager.encode.redeemDelegations({
 *     delegations: [[signed]],            // OUTER array = one per delegation-CHAIN; inner = the chain
 *     modes:       [ExecutionMode.SingleDefault],
 *     executions:  [[execution]],         // OUTER array per chain; inner = executions for that chain
 *   });
 *   await delegateWallet.sendTransaction({
 *     to: getSmartAccountsEnvironment(chainId).DelegationManager, data });
 *   // The DelegationManager validates caveats (the ERC20PeriodTransferEnforcer cap)
 *   // and forwards the transfer execution to the treasury smart account, which
 *   // executes USDC.transfer(...) from ITS OWN balance. Over-cap => revert.
 *
 * READ remaining period budget on-chain:
 *   import { actions } from "@metamask/smart-accounts-kit";
 *   const { availableAmount } = await actions.getErc20PeriodTransferEnforcerAvailableAmount({
 *     client, delegationManager, delegationHash, enforcer, terms });
 *   (We instead infer remaining budget from the USDC transferred so far, which is robust.)
 * ============================================================================
 */

import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseEther,
  formatUnits,
  erc20Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  toMetaMaskSmartAccount,
  Implementation,
  createDelegation,
  createExecution,
  ScopeType,
  ExecutionMode,
  getSmartAccountsEnvironment,
  contracts,
} from "@metamask/smart-accounts-kit";

import { USDC, toUsdcAtoms } from "../src/chain.js";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
// repo root .env (packages/core/scripts -> ../../../.env)
loadEnv({ path: resolve(__dirname, "../../../.env") });

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
if (!PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY not found in .env at repo root");
}

const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const chain = baseSepolia;
const env = getSmartAccountsEnvironment(chain.id);

const explorer = (h: string) => `https://sepolia.basescan.org/tx/${h}`;
const usd = (atoms: bigint) => `$${formatUnits(atoms, 6)}`;

function transferCalldata(to: Address, atoms: bigint): Hex {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, atoms],
  });
}

async function main() {
  const owner = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain, transport: http(RPC_URL) });
  const ownerWallet = createWalletClient({
    account: owner,
    chain,
    transport: http(RPC_URL),
  });

  console.log("=".repeat(72));
  console.log("sip402 RAIL PROOF — Base Sepolia (chainId", chain.id + ")");
  console.log("=".repeat(72));
  console.log("Owner EOA:        ", owner.address);
  console.log("DelegationManager:", env.DelegationManager);
  console.log("SimpleFactory:    ", env.SimpleFactory);
  console.log("USDC:             ", USDC);

  const ownerEth = await publicClient.getBalance({ address: owner.address });
  const ownerUsdc = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner.address],
  });
  console.log("Owner ETH:        ", formatUnits(ownerEth, 18));
  console.log("Owner USDC:       ", usd(ownerUsdc));
  if (ownerEth === 0n) throw new Error("Owner EOA has no ETH for gas");

  // -------------------------------------------------------------------------
  // 1) Treasury (delegator) smart account — create + DEPLOY on-chain
  // -------------------------------------------------------------------------
  console.log("\n[1] Treasury smart account");
  const treasury = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [owner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: owner },
  });
  console.log("    address:", treasury.address);

  let deployed = await contracts.isContractDeployed({
    client: publicClient,
    contractAddress: treasury.address,
  });
  console.log("    deployed?", deployed);

  if (!deployed) {
    const { factory, factoryData } = await treasury.getFactoryArgs();
    console.log("    deploying via SimpleFactory (plain EOA tx, no bundler)...");
    const deployHash = await ownerWallet.sendTransaction({
      to: factory as Address,
      data: factoryData as Hex,
    });
    console.log("    deploy tx:", explorer(deployHash));
    const rcpt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
    console.log("    deploy status:", rcpt.status);
    if (rcpt.status !== "success") throw new Error("Treasury deploy tx reverted");
    // RPC nodes behind a load balancer can briefly return stale (no-code) state
    // right after the receipt; poll until code shows up.
    for (let i = 0; i < 10 && !deployed; i++) {
      deployed = await contracts.isContractDeployed({
        client: publicClient,
        contractAddress: treasury.address,
      });
      if (!deployed) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!deployed) throw new Error("Treasury deploy failed: no code at address");
  }
  console.log("    treasury DEPLOYED ✔");

  // Fund the treasury smart account with USDC so it has a balance to transfer.
  const treasuryUsdc = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [treasury.address],
  });
  console.log("    treasury USDC:", usd(treasuryUsdc));
  const NEED = toUsdcAtoms(2); // enough to cover the $1 cap with margin
  if (treasuryUsdc < NEED) {
    const topUp = NEED - treasuryUsdc;
    console.log("    funding treasury with", usd(topUp), "USDC from owner...");
    const fundHash = await ownerWallet.sendTransaction({
      to: USDC,
      data: transferCalldata(treasury.address, topUp),
    });
    const fr = await publicClient.waitForTransactionReceipt({ hash: fundHash });
    console.log("    fund tx:", explorer(fundHash), "status:", fr.status);
  }

  // -------------------------------------------------------------------------
  // 2) Delegate session keypair (fresh EOA) — fund a little ETH for gas
  // -------------------------------------------------------------------------
  console.log("\n[2] Delegate session EOA");
  const delegatePk = generatePrivateKey();
  const delegate = privateKeyToAccount(delegatePk);
  const delegateWallet = createWalletClient({
    account: delegate,
    chain,
    transport: http(RPC_URL),
  });
  console.log("    delegate:", delegate.address);

  const fundEthHash = await ownerWallet.sendTransaction({
    to: delegate.address,
    value: parseEther("0.01"),
  });
  await publicClient.waitForTransactionReceipt({ hash: fundEthHash });
  const delEth = await publicClient.getBalance({ address: delegate.address });
  console.log("    delegate ETH:", formatUnits(delEth, 18), "(", explorer(fundEthHash), ")");

  // -------------------------------------------------------------------------
  // 3) Treasury creates + signs the periodic delegation ($1/day USDC cap)
  // -------------------------------------------------------------------------
  console.log("\n[3] Periodic delegation (Erc20PeriodTransfer)");
  const periodAmount = toUsdcAtoms(1); // $1.00 per period cap
  const periodDuration = 86400; // 1 day
  const startDate = 1749470400; // FIXED unix ts (2025-06-09T12:00:00Z) — recent, not now-derived

  const delegation = createDelegation({
    scope: {
      type: ScopeType.Erc20PeriodTransfer,
      tokenAddress: USDC,
      periodAmount,
      periodDuration,
      startDate,
    },
    to: delegate.address,
    from: treasury.address,
    environment: treasury.environment,
  });
  const signature = await treasury.signDelegation({ delegation });
  const signedDelegation = { ...delegation, signature };
  console.log("    cap:", usd(periodAmount), "/", periodDuration + "s");
  console.log("    delegate:", signedDelegation.delegate);
  console.log("    delegator:", signedDelegation.delegator);
  console.log("    signed ✔ (sig len", signature.length, ")");

  // Helper: redeem ONE transfer draw against the signed delegation, as the delegate EOA.
  async function draw(label: string, recipient: Address, atoms: bigint) {
    const execution = createExecution({
      target: USDC,
      value: 0n,
      callData: transferCalldata(recipient, atoms),
    });
    const data = contracts.DelegationManager.encode.redeemDelegations({
      delegations: [[signedDelegation]],
      modes: [ExecutionMode.SingleDefault],
      executions: [[execution]],
    });
    const hash = await delegateWallet.sendTransaction({
      to: env.DelegationManager as Address,
      data,
    });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`    ${label}: status=${rcpt.status} tx=${explorer(hash)}`);
    if (rcpt.status !== "success") {
      throw new Error(`${label} reverted unexpectedly`);
    }
    return hash;
  }

  const recipient = owner.address; // any recipient; send the sips back to owner

  const before = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [recipient],
  });

  // -------------------------------------------------------------------------
  // 4) Draw #1 — $0.10
  // -------------------------------------------------------------------------
  console.log("\n[4] Draw #1 — transfer", usd(toUsdcAtoms(0.1)));
  const draw1 = await draw("DRAW#1", recipient, toUsdcAtoms(0.1));

  // -------------------------------------------------------------------------
  // 5) Draw #2 — $0.10 (cumulative against SAME delegation)
  // -------------------------------------------------------------------------
  console.log("\n[5] Draw #2 — transfer", usd(toUsdcAtoms(0.1)), "(cumulative)");
  const draw2 = await draw("DRAW#2", recipient, toUsdcAtoms(0.1));

  const afterTwo = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [recipient],
  });
  console.log("    recipient USDC delta after 2 draws:", usd(afterTwo - before));

  // -------------------------------------------------------------------------
  // 6) Over-cap draw — $0.90 (0.20 used + 0.90 = 1.10 > 1.00 cap) => REVERT
  // -------------------------------------------------------------------------
  console.log("\n[6] Over-cap draw — transfer", usd(toUsdcAtoms(0.9)), "(expect REVERT)");
  let dryTabConfirmed = false;
  try {
    const execution = createExecution({
      target: USDC,
      value: 0n,
      callData: transferCalldata(recipient, toUsdcAtoms(0.9)),
    });
    const data = contracts.DelegationManager.encode.redeemDelegations({
      delegations: [[signedDelegation]],
      modes: [ExecutionMode.SingleDefault],
      executions: [[execution]],
    });
    // simulate/send: most nodes will reject on estimateGas (pre-flight revert).
    const hash = await delegateWallet.sendTransaction({
      to: env.DelegationManager as Address,
      data,
    });
    const rcpt = await publicClient.waitForTransactionReceipt({ hash });
    if (rcpt.status === "reverted") {
      dryTabConfirmed = true;
      console.log("    over-cap tx mined but REVERTED:", explorer(hash));
    } else {
      console.log("    !! over-cap draw SUCCEEDED unexpectedly:", explorer(hash));
    }
  } catch (err) {
    dryTabConfirmed = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.log("    over-cap draw rejected pre-flight (revert):", msg.split("\n")[0]);
  }
  if (dryTabConfirmed) {
    console.log("    DRY-TAB CONFIRMED: over-cap draw reverted as expected ✔");
  } else {
    throw new Error("DRY-TAB FAILED: over-cap draw did NOT revert");
  }

  // Prove the meter still allows a within-budget draw after the over-cap rejection.
  console.log("\n[6b] Remaining-budget draw — transfer", usd(toUsdcAtoms(0.1)), "(0.20+0.10=0.30 <= 1.00)");
  const draw3 = await draw("DRAW#3", recipient, toUsdcAtoms(0.1));

  // -------------------------------------------------------------------------
  // 7) Summary
  // -------------------------------------------------------------------------
  const finalRecipient = await publicClient.readContract({
    address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [recipient],
  });
  console.log("\n" + "=".repeat(72));
  console.log("RAIL PROOF SUMMARY");
  console.log("=".repeat(72));
  console.log("Treasury (delegator) smart account:", treasury.address);
  console.log("Delegate (session) EOA:            ", delegate.address);
  console.log("Period cap:                        ", usd(periodAmount), "/", periodDuration + "s");
  console.log("Draw #1 ($0.10):  ", explorer(draw1));
  console.log("Draw #2 ($0.10):  ", explorer(draw2));
  console.log("Over-cap ($0.90): REVERTED (dry tab confirmed)");
  console.log("Draw #3 ($0.10):  ", explorer(draw3));
  console.log("Total drawn (recipient USDC delta):", usd(finalRecipient - before));
  console.log("=".repeat(72));
  console.log("RAIL PROOF: PASS ✔  (real Base Sepolia transactions)");
}

main().catch((e) => {
  console.error("\nRAIL PROOF FAILED:");
  console.error(e);
  process.exit(1);
});
