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
  getAddress,
  bytesToHex,
  parseUnits,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { randomBytes } from "node:crypto";
import {
  contracts,
  createExecution,
  createDelegation,
  toMetaMaskSmartAccount,
  Implementation,
  ScopeType,
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
import {
  estimate7710Transaction,
  send7710Transaction,
  pollUntilTerminal,
  toRelayerJson,
  getCapabilities,
  type AuthorizationListEntry,
  type Send7710Params,
} from "./oneshot.js";

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

export interface BatchSettleResult extends SettleResult {
  /** Number of commitments redeemed in this single transaction. */
  count: number;
  /** Sum of all commitment amounts settled in this transaction (atoms). */
  totalAtoms: bigint;
}

export interface Settler {
  /**
   * Settle one sip: redeem the signed delegation to execute a USDC transfer
   * of `atoms` to `payTo`.
   */
  settle(args: {
    /**
     * The full signed permission context for DirectRedeemSettler (a Hex chain or
     * Delegation[]). OneShotSettler signs its own delegation from ownerAccount,
     * so it is optional there.
     */
    signedDelegation?: unknown;
    payTo: Address;
    atoms: bigint;
  }): Promise<SettleResult>;

  /**
   * Batch-settle MANY commitments in ONE transaction (the batch-settlement
   * scheme): redeem the permission context once per commitment within a single
   * redeemDelegations call. The on-chain period enforcer accumulates across the
   * batch, so an over-cap batch reverts atomically (the whole tx fails — the
   * "dry tab"). Optional; implemented by DirectRedeemSettler.
   */
  settleBatch?(args: {
    signedDelegation?: unknown;
    payTo: Address;
    atomsList: bigint[];
  }): Promise<BatchSettleResult>;
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
      if (signedDelegation === undefined || signedDelegation === null) {
        throw new Error("DirectRedeemSettler requires a signedDelegation (permission context)");
      }
      // Build the USDC transfer execution
      const transferExec = buildTransferExecution(payTo, atoms);

      // Convert to smart-accounts-kit Execution type
      const execution = createExecution({
        target: transferExec.target,
        value: transferExec.value,
        callData: transferExec.callData,
      });

      // Encode the redeemDelegations call (proven rail-proof.ts / server pattern).
      // `delegations` is PermissionContext[], where each PermissionContext is the
      // FULL signed delegation chain — either an encoded Hex blob or a Delegation[].
      // `signedDelegation` here IS that full permission context (a Hex chain from
      // client.createCommitment, or a Delegation[]); it is one entry in delegations[].
      // (Do NOT wrap it again as [[...]] — that double-nests and the redemption reverts.)
      const data = contracts.DelegationManager.encode.redeemDelegations({
        delegations: [signedDelegation as Hex | Delegation[]],
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

    async settleBatch({ signedDelegation, payTo, atomsList }) {
      if (signedDelegation === undefined || signedDelegation === null) {
        throw new Error("DirectRedeemSettler requires a signedDelegation (permission context)");
      }
      if (!atomsList.length) {
        throw new Error("settleBatch requires at least one commitment");
      }

      // One execution per commitment, all against the SAME permission context.
      // redeemDelegations takes parallel arrays — N contexts / N modes / N
      // executions — and runs them in one tx. The ERC20PeriodTransferEnforcer
      // accumulates across them, so an over-cap batch reverts atomically.
      const executions = atomsList.map((atoms) => {
        const t = buildTransferExecution(payTo, atoms);
        return [createExecution({ target: t.target, value: t.value, callData: t.callData })];
      });

      const data = contracts.DelegationManager.encode.redeemDelegations({
        delegations: atomsList.map(() => signedDelegation as Hex | Delegation[]),
        modes: atomsList.map(() => ExecutionMode.SingleDefault),
        executions,
      });

      const txHash = await walletClient.sendTransaction({
        to: env.DelegationManager as Address,
        data,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status === "reverted") {
        throw new Error(`batch settle tx reverted: ${txHash}`);
      }

      const totalAtoms = atomsList.reduce((a, b) => a + b, 0n);
      return { txHash, count: atomsList.length, totalAtoms };
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
 * Performs the PROVEN 1Shot EIP-7702 + gas-in-USDC flow (see
 * scripts/oneshot-mainnet-proof.ts, proven on Base mainnet tx
 * 0x26a44ffedefb113e6a6c1aa266985076684dea9faaea097f92e4f3e1731940e9):
 *
 *   1. getCapabilities -> targetAddress (delegation `to`) + feeCollector.
 *   2. Upgrade the signer EOA to a Stateless7702 delegator smart account; on
 *      first use sign an EIP-7702 authorization (the relayer lands it in the
 *      redeem tx, so the EOA pays NO ETH).
 *   3. Create + sign ONE delegation scoped to (fee + work) USDC, `to` = targetAddress.
 *   4. estimate7710Transaction (mock fee >= minFee) -> requiredPaymentAmount + context;
 *      if the fee differs, re-sign at the exact fee and re-estimate.
 *   5. send7710Transaction({ context, authorizationList }) -> taskId.
 *   6. pollUntilTerminal -> on-chain txHash (status 200).
 *
 * The settler signs delegations itself from `ownerAccount`, so the caller does
 * NOT need to pre-build a permission context. `signedDelegation` is accepted for
 * interface symmetry with DirectRedeemSettler but is not required.
 */
export function createOneShotSettler(opts: {
  /** The signer EOA that owns the USDC and authorizes the relayer (the delegator). */
  ownerAccount: LocalAccount;
  /** Optional override for the RPC URL (defaults to chain.ts DEFAULT_RPC_URL). */
  rpcUrl?: string;
  /** Optional override for the 1Shot relayer URL. */
  relayerUrl?: string;
  /** Optional webhook URL for relayer status events (≤256 chars). */
  destinationUrl?: string;
}): Settler {
  const relayerUrl = opts.relayerUrl ?? ONESHOT_RELAYER_URL;
  const rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;

  if (!ONESHOT_TARGET_ADDRESS) {
    // Warn at creation time if this is accidentally used on testnet.
    console.warn(
      "[OneShotSettler] ONESHOT_TARGET_ADDRESS is undefined — this settler is mainnet-only. " +
      "Use createDirectRedeemSettler() on Base Sepolia."
    );
  }

  const publicClient = createPublicClient({ chain: CHAIN, transport: http(rpcUrl) });
  const env = getSmartAccountsEnvironment(CHAIN_ID);

  return {
    async settle({ payTo, atoms }) {
      if (!ONESHOT_TARGET_ADDRESS) {
        throw new Error(
          "OneShotSettler is mainnet-only (ONESHOT_TARGET_ADDRESS undefined). " +
          "Use createDirectRedeemSettler() on testnet."
        );
      }

      const eoa = opts.ownerAccount;

      // [1] Capabilities — authoritative targetAddress (delegation `to`) + feeCollector.
      const caps = await getCapabilities(String(CHAIN_ID), relayerUrl);
      const chainCaps = caps[String(CHAIN_ID)];
      if (!chainCaps) {
        throw new Error(`1Shot relayer has no capabilities for chain ${CHAIN_ID}`);
      }
      const { targetAddress, feeCollector } = chainCaps;

      // [2] Stateless7702 delegator smart account (the EOA itself).
      // Cast client: the kit bundles its own viem types, which differ structurally
      // from ours despite being runtime-compatible (proven in oneshot-mainnet-proof.ts).
      const smartAccount = await toMetaMaskSmartAccount({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: publicClient as any,
        implementation: Implementation.Stateless7702,
        address: eoa.address,
        signer: { account: eoa },
      });

      // First use: sign an EIP-7702 authorization so the relayer upgrades the EOA
      // to the stateless delegator in-flight (EOA pays no ETH). Skip if already upgraded.
      const code = await publicClient.getCode({ address: eoa.address });
      const needsUpgrade = !code || code === "0x";
      let authorizationList: AuthorizationListEntry[] | undefined;
      if (needsUpgrade) {
        const nonce = await publicClient.getTransactionCount({
          address: eoa.address,
          blockTag: "pending",
        });
        if (typeof eoa.signAuthorization !== "function") {
          throw new Error(
            "ownerAccount cannot sign EIP-7702 authorizations (needs a LocalAccount from privateKeyToAccount)"
          );
        }
        const auth = await eoa.signAuthorization({
          chainId: CHAIN_ID,
          contractAddress: getAddress(env.implementations.EIP7702StatelessDeleGatorImpl),
          nonce,
        });
        authorizationList = [
          {
            address: auth.address,
            chainId: auth.chainId,
            nonce: auth.nonce,
            r: auth.r,
            s: auth.s,
            yParity: auth.yParity ?? 0,
          },
        ];
      }

      // [3] Build + sign ONE delegation scoped to (fee + work), `to` = targetAddress.
      const buildBundle = async (feeAmount: bigint): Promise<Send7710Params> => {
        const delegation = createDelegation({
          to: targetAddress,
          from: smartAccount.address,
          environment: smartAccount.environment,
          salt: bytesToHex(Uint8Array.from(randomBytes(32))) as Hex,
          scope: {
            type: ScopeType.Erc20TransferAmount,
            tokenAddress: USDC,
            maxAmount: feeAmount + atoms,
          },
        });
        const signature = await smartAccount.signDelegation({ delegation });

        const feeCalldata = encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [feeCollector, feeAmount],
        });
        const { callData: workCalldata } = buildTransferExecution(payTo, atoms);

        return {
          relayerUrl,
          chainId: String(CHAIN_ID),
          transactions: [
            {
              permissionContext: [
                toRelayerJson({ ...delegation, signature }) as Record<string, unknown>,
              ],
              executions: [
                { target: USDC, value: "0", data: feeCalldata },
                { target: USDC, value: "0", data: workCalldata },
              ],
            },
          ],
          ...(authorizationList ? { authorizationList } : {}),
          ...(opts.destinationUrl ? { destinationUrl: opts.destinationUrl } : {}),
        };
      };

      // [4] Estimate with a mock fee >= minFee ($0.01); re-sign at the exact fee if needed.
      const mockFee = parseUnits("0.01", 6);
      let params = await buildBundle(mockFee);
      let estimate = await estimate7710Transaction(params);
      if (!estimate.success) {
        throw new Error(`1Shot estimate failed: ${estimate.error ?? "(no error)"}`);
      }
      const requiredFee = BigInt(estimate.requiredPaymentAmount ?? "0");
      if (requiredFee !== mockFee) {
        params = await buildBundle(requiredFee);
        estimate = await estimate7710Transaction(params);
        if (!estimate.success) {
          throw new Error(`1Shot re-estimate failed: ${estimate.error ?? "(no error)"}`);
        }
      }
      if (!estimate.context) {
        throw new Error("1Shot estimate returned no price-lock context");
      }

      // [5] Send with the signed price-lock context.
      const taskId = await send7710Transaction({ ...params, context: estimate.context });

      // [6] Poll until terminal; return the on-chain tx hash.
      const final = await pollUntilTerminal(taskId, { relayerUrl });
      if (final.status !== 200) {
        throw new Error(
          `1Shot relay failed (status ${final.status}): ` +
            (final.message ?? JSON.stringify(final.data))
        );
      }
      const txHash = (final.receipt?.transactionHash ?? final.hash) as string;
      if (!txHash) {
        throw new Error("1Shot confirmed but returned no tx hash");
      }
      return { txHash };
    },

    // Batch-settle N commitments in ONE gasless relayed redeemDelegations: a single
    // delegation scoped to (fee + Σ draws) authorizes N+1 executions [fee, w1..wN].
    // The relayer merges them into one tx (proven: relayer_estimate accepts the
    // shape). Same flow as settle() — only the executions array grows.
    async settleBatch({ signedDelegation, payTo, atomsList }) {
      if (!ONESHOT_TARGET_ADDRESS) {
        throw new Error(
          "OneShotSettler is mainnet-only (ONESHOT_TARGET_ADDRESS undefined). " +
          "Use createDirectRedeemSettler() on testnet."
        );
      }
      if (!atomsList.length) throw new Error("settleBatch requires at least one commitment");

      const eoa = opts.ownerAccount;
      const totalAtoms = atomsList.reduce((a, b) => a + b, 0n);

      // GRANT MODE: the caller passes the redelegation chain (session → 1Shot target,
      // inheriting the grant's ERC20PeriodTransferEnforcer) as an array of relayer-JSON
      // delegations. We redeem THAT, so the on-chain period cap applies and an over-cap
      // batch reverts atomically — proven via relayer_estimate in scripts/_probe-grant.
      // SELF-SIGN MODE (no signedDelegation): sign a simple owner→target delegation
      // scoped to exactly (fee + Σ), which has no period cap.
      const grantChain = Array.isArray(signedDelegation)
        ? (signedDelegation as Record<string, unknown>[])
        : null;

      // [1] Capabilities — authoritative targetAddress (delegation `to`) + feeCollector.
      const caps = await getCapabilities(String(CHAIN_ID), relayerUrl);
      const chainCaps = caps[String(CHAIN_ID)];
      if (!chainCaps) throw new Error(`1Shot relayer has no capabilities for chain ${CHAIN_ID}`);
      const { targetAddress, feeCollector } = chainCaps;

      // [2] Self-sign only: build the owner's Stateless7702 delegator + (first use)
      // an EIP-7702 authorization so the relayer upgrades the EOA in-flight. In grant
      // mode the grantor is already a deployed smart account, so neither is needed.
      let smartAccount: Awaited<ReturnType<typeof toMetaMaskSmartAccount>> | undefined;
      let authorizationList: AuthorizationListEntry[] | undefined;
      if (!grantChain) {
        smartAccount = await toMetaMaskSmartAccount({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          client: publicClient as any,
          implementation: Implementation.Stateless7702,
          address: eoa.address,
          signer: { account: eoa },
        });
        const code = await publicClient.getCode({ address: eoa.address });
        const needsUpgrade = !code || code === "0x";
        if (needsUpgrade) {
          const nonce = await publicClient.getTransactionCount({ address: eoa.address, blockTag: "pending" });
          if (typeof eoa.signAuthorization !== "function") {
            throw new Error("ownerAccount cannot sign EIP-7702 authorizations (needs a LocalAccount from privateKeyToAccount)");
          }
          const auth = await eoa.signAuthorization({
            chainId: CHAIN_ID,
            contractAddress: getAddress(env.implementations.EIP7702StatelessDeleGatorImpl),
            nonce,
          });
          authorizationList = [
            { address: auth.address, chainId: auth.chainId, nonce: auth.nonce, r: auth.r, s: auth.s, yParity: auth.yParity ?? 0 },
          ];
        }
      }

      // [3] Build the bundle: executions = [fee → feeCollector, work_i → payTo …].
      // permissionContext is the provided grant chain (grant mode) or a freshly
      // signed owner→target delegation scoped to (fee + Σ) (self-sign mode).
      const buildBundle = async (feeAmount: bigint): Promise<Send7710Params> => {
        const feeCalldata = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [feeCollector, feeAmount] });
        const workExecutions = atomsList.map((atoms) => {
          const { callData } = buildTransferExecution(payTo, atoms);
          return { target: USDC, value: "0", data: callData };
        });
        const executions = [{ target: USDC, value: "0", data: feeCalldata }, ...workExecutions];

        let permissionContext: Record<string, unknown>[];
        if (grantChain) {
          permissionContext = grantChain;
        } else {
          const delegation = createDelegation({
            to: targetAddress,
            from: smartAccount!.address,
            environment: smartAccount!.environment,
            salt: bytesToHex(Uint8Array.from(randomBytes(32))) as Hex,
            scope: { type: ScopeType.Erc20TransferAmount, tokenAddress: USDC, maxAmount: feeAmount + totalAtoms },
          });
          const signature = await smartAccount!.signDelegation({ delegation });
          permissionContext = [toRelayerJson({ ...delegation, signature }) as Record<string, unknown>];
        }

        return {
          relayerUrl,
          chainId: String(CHAIN_ID),
          transactions: [{ permissionContext: permissionContext as never, executions: executions as never }],
          ...(authorizationList ? { authorizationList } : {}),
          ...(opts.destinationUrl ? { destinationUrl: opts.destinationUrl } : {}),
        };
      };

      // [4] Estimate (mock fee), re-sign at the exact required fee if it differs.
      const mockFee = parseUnits("0.01", 6);
      let params = await buildBundle(mockFee);
      let estimate = await estimate7710Transaction(params);
      if (!estimate.success) throw new Error(`1Shot batch estimate failed: ${estimate.error ?? "(no error)"}`);
      const requiredFee = BigInt(estimate.requiredPaymentAmount ?? "0");
      if (requiredFee !== mockFee) {
        params = await buildBundle(requiredFee);
        estimate = await estimate7710Transaction(params);
        if (!estimate.success) throw new Error(`1Shot batch re-estimate failed: ${estimate.error ?? "(no error)"}`);
      }
      if (!estimate.context) throw new Error("1Shot batch estimate returned no price-lock context");

      // [5] Send + [6] poll until terminal.
      const taskId = await send7710Transaction({ ...params, context: estimate.context });
      const final = await pollUntilTerminal(taskId, { relayerUrl });
      if (final.status !== 200) {
        throw new Error(`1Shot batch relay failed (status ${final.status}): ` + (final.message ?? JSON.stringify(final.data)));
      }
      const txHash = (final.receipt?.transactionHash ?? final.hash) as string;
      if (!txHash) throw new Error("1Shot batch confirmed but returned no tx hash");
      return { txHash, count: atomsList.length, totalAtoms };
    },
  };
}
