/**
 * settle.ts — Settler abstraction for sip402.
 *
 * Provides:
 *   - Execution / SettleResult types
 *   - buildTransferExecution() — pure helper to build a USDC transfer Execution
 *   - Settler interface — single settle(args) method
 *   - createDirectRedeemSettler() — TESTNET: delegate EOA redeems directly via DelegationManager
 *   - createOneShotSettler() — MAINNET: gasless settlement through the 1Shot relayer
 *
 * The DirectRedeemSettler reuses the EXACT proven pattern from scripts/rail-proof.ts:
 *   contracts.DelegationManager.encode.redeemDelegations(...)  =>  walletClient.sendTransaction(...)
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  erc20Abi,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import {
  contracts,
  createExecution,
  ExecutionMode,
  getSmartAccountsEnvironment,
  type Delegation,
} from "@metamask/smart-accounts-kit";

import {
  USDC,
  CHAIN,
  CHAIN_ID,
  DEFAULT_RPC_URL,
  ONESHOT_TARGET_ADDRESS,
  ONESHOT_RELAYER_URL,
} from "./chain.js";
import { send7710Transaction } from "./oneshot.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface Execution {
  target: Address;
  value: bigint;
  callData: Hex;
}

export interface SettleResult {
  txHash: string;
}

export interface Settler {
  /**
   * Settle one sip: redeem the signed delegation to execute a USDC transfer
   * of `atoms` to `payTo`.
   */
  settle(args: {
    signedDelegation: unknown;
    payTo: Address;
    atoms: bigint;
  }): Promise<SettleResult>;
}

// ---------------------------------------------------------------------------
// buildTransferExecution — pure helper
// ---------------------------------------------------------------------------

/**
 * Build a USDC ERC-20 transfer Execution struct.
 * target = USDC contract from chain.ts; value = 0n; callData = transfer(payTo, atoms).
 */
export function buildTransferExecution(payTo: Address, atoms: bigint): Execution {
  const callData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [payTo, atoms],
  });
  return { target: USDC, value: 0n, callData };
}

// ---------------------------------------------------------------------------
// DirectRedeemSettler — testnet backend (no bundler, no relayer)
// ---------------------------------------------------------------------------

/**
 * Create a Settler that redeems delegations directly via the DelegationManager
 * from the delegate EOA's wallet. This is the proven rail-proof.ts flow:
 *
 *   1. Build the USDC transfer Execution.
 *   2. Encode redeemDelegations({ delegations: [[signed]], modes: [...], executions: [[exec]] }).
 *   3. Send as a plain EOA tx to env.DelegationManager (delegate pays gas).
 *   4. Wait for receipt; throw if reverted.
 *
 * Suitable for testnet (Base Sepolia). On mainnet, use createOneShotSettler.
 */
export function createDirectRedeemSettler(opts: {
  delegateAccount: LocalAccount;
  rpcUrl?: string;
}): Settler {
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
  const env = getSmartAccountsEnvironment(CHAIN_ID);

  const publicClient = createPublicClient({
    chain: CHAIN,
    transport: http(rpcUrl),
  });

  const walletClient = createWalletClient({
    account: opts.delegateAccount,
    chain: CHAIN,
    transport: http(rpcUrl),
  });

  return {
    async settle({ signedDelegation, payTo, atoms }) {
      // Build the USDC transfer execution
      const transferExec = buildTransferExecution(payTo, atoms);

      // Convert to smart-accounts-kit Execution type
      const execution = createExecution({
        target: transferExec.target,
        value: transferExec.value,
        callData: transferExec.callData,
      });

      // Encode the redeemDelegations call (proven rail-proof.ts pattern).
      // delegations is PermissionContext[] where each PermissionContext = Delegation[] | Hex.
      // One delegation-chain = [signedDelegation] (array of Delegation for the chain).
      const data = contracts.DelegationManager.encode.redeemDelegations({
        delegations: [[signedDelegation as Delegation]],
        modes: [ExecutionMode.SingleDefault],
        executions: [[execution]],
      });

      // Send plain EOA tx to DelegationManager (delegate pays gas, no bundler)
      const txHash = await walletClient.sendTransaction({
        to: env.DelegationManager as Address,
        data,
      });

      // Wait for receipt and verify success
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === "reverted") {
        throw new Error(`settle tx reverted: ${txHash}`);
      }

      return { txHash };
    },
  };
}

// ---------------------------------------------------------------------------
// OneShotSettler — mainnet backend (gasless, USDC fees via 1Shot relayer)
// ---------------------------------------------------------------------------

/**
 * NOTE: This settler is MAINNET ONLY (Base, chainId 8453).
 * It will not be exercised on testnet — ONESHOT_TARGET_ADDRESS is undefined on Base Sepolia.
 *
 * Uses the 1Shot relayer to submit the ERC-7710 delegation redemption transaction
 * gaslessly, with fees deducted in USDC from the session budget.
 *
 * Wiring the permissionContext (the signed delegation blob) is the caller's
 * responsibility; the opts object is intentionally open for future extension.
 */
export function createOneShotSettler(opts: {
  /** The permission context (signed delegation) to pass to the relayer. */
  permissionContext?: Hex;
  /** Optional override for the 1Shot relayer URL. */
  relayerUrl?: string;
}): Settler {
  const relayerUrl = opts.relayerUrl ?? ONESHOT_RELAYER_URL;

  if (!ONESHOT_TARGET_ADDRESS) {
    // Warn at creation time if this is accidentally used on testnet.
    console.warn(
      "[OneShotSettler] ONESHOT_TARGET_ADDRESS is undefined — this settler is mainnet-only. " +
      "Use createDirectRedeemSettler() on Base Sepolia."
    );
  }

  return {
    async settle({ signedDelegation, payTo, atoms }) {
      if (!ONESHOT_TARGET_ADDRESS) {
        throw new Error(
          "OneShotSettler is mainnet-only (ONESHOT_TARGET_ADDRESS undefined). " +
          "Use createDirectRedeemSettler() on testnet."
        );
      }

      // Build the USDC transfer execution callData
      const { callData } = buildTransferExecution(payTo, atoms);

      // Send via the 1Shot relayer's send7710Transaction method.
      // The relayer submits the delegation redemption and pays gas, recovering
      // its fee in USDC via the session's permission context.
      // The permission context must be the ABI-encoded delegation chain expected by
      // the relayer (resolved on mainnet wiring). We do not guess it from the signature:
      // a wrong context produces a silent bad relayer call, so require it explicitly.
      const permissionContext =
        opts.permissionContext ??
        (typeof (signedDelegation as { permissionContext?: Hex }).permissionContext === "string"
          ? (signedDelegation as { permissionContext: Hex }).permissionContext
          : undefined);
      if (!permissionContext) {
        throw new Error(
          "OneShotSettler requires an explicit permissionContext (the ABI-encoded delegation chain). " +
          "Pass it via createOneShotSettler({ permissionContext }) or on the signedDelegation. " +
          "Refusing to send a relayer call with an unresolved context."
        );
      }

      const result = await send7710Transaction({
        relayerUrl,
        chainId: String(CHAIN_ID),
        permissionContext,
        // The execution: transfer USDC to payTo
        target: USDC,
        callData,
        value: "0x0",
      });

      if (!result.taskId) {
        throw new Error(`1Shot relayer returned no taskId: ${JSON.stringify(result)}`);
      }

      // The 1Shot relayer is async; return the taskId as txHash for polling.
      // Callers that need confirmation can poll getStatus(taskId).
      return { txHash: result.taskId };
    },
  };
}
