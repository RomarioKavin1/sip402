/**
 * accumulator.ts — the seller's voucher store + BATCH redemption driver.
 *
 * This is the heart of the sip402 `batch-settlement` binding's seller side
 * (SPEC §5.2 Accumulate + §5.3 Redeem):
 *
 *   accept(commitment)              → verify-by-simulation (SPEC §6) + store it
 *   recordAndMaybeFlush(commitment) → accept(), then auto-flush at minBatchAtoms
 *   flush()                         → redeem ALL pending commitments in ONE batch tx
 *
 * BATCH REDEMPTION (the load-bearing capability). redeemDelegations accepts
 * arrays-of-arrays — N commitments settle in ONE transaction. Resolved from the
 * proven single-redeem encoding (binding-proof.ts): the outer `delegations`,
 * `modes`, and `executions` arrays simply gain one entry per commitment:
 *
 *   redeemDelegations({
 *     delegations: [ ctxA, ctxB, ctxC ],                        // permissionContext per commitment (leaf-first Hex)
 *     modes:       [ SingleDefault, SingleDefault, SingleDefault ],
 *     executions:  [ [transfer(seller, amtA)], [transfer(seller, amtB)], [transfer(seller, amtC)] ],
 *   })
 *
 * sent as a plain tx (testnet, seller pays gas) to env.DelegationManager. An
 * explicit, generous gas limit is set (per-commitment chain validation is deep).
 *
 * On mainnet the seller relays gaslessly via 1Shot (createOneShotSettler);
 * 1Shot's per-call relayer settles one permissionContext at a time, so the
 * mainnet path flushes commitments individually through the relayer. That path
 * only runs on mainnet; testnet uses the direct batch tx.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  decodeEventLog,
  erc20Abi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  contracts,
  createExecution,
  ExecutionMode,
  getSmartAccountsEnvironment,
  type PermissionContext,
} from "@metamask/smart-accounts-kit";

import {
  USDC,
  CHAIN,
  CHAIN_ID,
  DEFAULT_RPC_URL,
  IS_MAINNET,
  buildTransferExecution,
  createOneShotSettler,
} from "@sip402/core";
import type { Commitment } from "@sip402/client";

import { verifyCommitment } from "./verify.js";

export interface SettlementEvent {
  type: "commit" | "settle";
  commitmentIds: Hex[];
  amountAtoms: bigint;
  txHash?: string;
  at: number;
}

interface PendingCommitment {
  commitment: Commitment;
  amountAtoms: bigint;
}

/** Gas limit for the batch redeem tx — generous: each commitment adds a deep
 *  delegation-chain validation. ~1.5M for a single depth-3 chain; scale per leaf. */
const PER_COMMITMENT_GAS = 1_500_000n;
const BASE_GAS = 200_000n;

export class CommitmentAccumulator {
  readonly #sellerPrivateKey: Hex;
  readonly #sellerAddress: Address;
  readonly #expectedPayTo: Address;
  readonly #minBatchAtoms: bigint;
  readonly #rpcUrl: string;
  readonly #onEvent?: (e: SettlementEvent) => void;

  readonly #usedNonces = new Set<string>();
  #pending: PendingCommitment[] = [];

  constructor(opts: {
    sellerPrivateKey: Hex;
    expectedPayTo: Address;
    minBatchAtoms: bigint;
    rpcUrl?: string;
    onEvent?: (e: SettlementEvent) => void;
  }) {
    this.#sellerPrivateKey = opts.sellerPrivateKey;
    this.#sellerAddress = privateKeyToAccount(opts.sellerPrivateKey).address;
    this.#expectedPayTo = opts.expectedPayTo;
    this.#minBatchAtoms = opts.minBatchAtoms;
    this.#rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
    this.#onEvent = opts.onEvent;
  }

  /** The seller EOA address (msg.sender for redemptions; also the redeem payTo). */
  get sellerAddress(): Address {
    return this.#sellerAddress;
  }

  /** Sum of accumulated-but-unsettled commitment amounts. */
  pendingAtoms(): bigint {
    return this.#pending.reduce((sum, p) => sum + p.amountAtoms, 0n);
  }

  #emit(e: SettlementEvent): void {
    this.#onEvent?.(e);
  }

  /**
   * Verify (SPEC §6, incl. on-chain simulation) and store a commitment.
   * Returns the commitmentId (the Commit-phase identifier). Throws on invalid.
   */
  async accept(commitment: Commitment): Promise<Hex> {
    const result = await verifyCommitment({
      commitment,
      expectedPayTo: this.#expectedPayTo,
      usedNonces: this.#usedNonces,
      seller: this.#sellerAddress,
      rpcUrl: this.#rpcUrl,
    });
    if (!result.isValid) {
      throw new Error(`commitment rejected: ${result.invalidReason ?? "invalid"}`);
    }

    // Reserve the nonce (off-chain double-spend layer, SPEC §7).
    this.#usedNonces.add(commitment.nonce.toLowerCase());
    this.#pending.push({ commitment, amountAtoms: BigInt(commitment.amount) });

    this.#emit({
      type: "commit",
      commitmentIds: [commitment.commitmentId],
      amountAtoms: BigInt(commitment.amount),
      at: Date.now(),
    });

    return commitment.commitmentId;
  }

  /**
   * Redeem ALL accumulated-but-unsettled commitments in ONE batch tx (testnet)
   * and return the batch txHash, or null if nothing is pending.
   *
   * On mainnet, relays each commitment through the 1Shot relayer (returns the
   * last relayer taskId).
   */
  async flush(): Promise<string | null> {
    if (this.#pending.length === 0) return null;

    const batch = this.#pending;
    this.#pending = [];

    const commitmentIds = batch.map((p) => p.commitment.commitmentId);
    const totalAtoms = batch.reduce((sum, p) => sum + p.amountAtoms, 0n);

    let txHash: string;
    try {
      txHash = IS_MAINNET
        ? await this.#flushViaRelayer(batch)
        : await this.#flushBatchDirect(batch);
    } catch (err) {
      // Restore pending on failure so commitments are not silently lost.
      this.#pending = batch.concat(this.#pending);
      throw err;
    }

    this.#emit({
      type: "settle",
      commitmentIds,
      amountAtoms: totalAtoms,
      txHash,
      at: Date.now(),
    });

    return txHash;
  }

  /** accept(), then auto-flush if pending >= minBatchAtoms. */
  async recordAndMaybeFlush(
    commitment: Commitment,
  ): Promise<{ commitmentId: Hex; settleTxHash?: string }> {
    const commitmentId = await this.accept(commitment);
    let settleTxHash: string | undefined;
    if (this.pendingAtoms() >= this.#minBatchAtoms) {
      settleTxHash = (await this.flush()) ?? undefined;
    }
    return { commitmentId, settleTxHash };
  }

  // ── TESTNET: ONE batch tx covering all pending commitments ─────────────────
  async #flushBatchDirect(batch: PendingCommitment[]): Promise<string> {
    const env = getSmartAccountsEnvironment(CHAIN_ID);
    const publicClient = createPublicClient({ chain: CHAIN, transport: http(this.#rpcUrl) });
    const account = privateKeyToAccount(this.#sellerPrivateKey);
    const wallet = createWalletClient({ account, chain: CHAIN, transport: http(this.#rpcUrl) });

    const delegations: PermissionContext[] = [];
    const modes = [];
    const executions = [];
    for (const { commitment, amountAtoms } of batch) {
      const transfer = buildTransferExecution(this.#sellerAddress, amountAtoms);
      delegations.push(commitment.permissionContext as PermissionContext);
      modes.push(ExecutionMode.SingleDefault);
      executions.push([
        createExecution({
          target: transfer.target,
          value: transfer.value,
          callData: transfer.callData,
        }),
      ]);
    }

    const data = contracts.DelegationManager.encode.redeemDelegations({
      delegations,
      modes,
      executions,
    });

    const gas = BASE_GAS + PER_COMMITMENT_GAS * BigInt(batch.length);
    const txHash = await wallet.sendTransaction({
      to: env.DelegationManager as Address,
      data,
      gas,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error(`batch redeem reverted: ${txHash}`);
    }
    return txHash;
  }

  // ── MAINNET: relay each commitment via 1Shot (gasless, USDC fees) ──────────
  async #flushViaRelayer(batch: PendingCommitment[]): Promise<string> {
    let lastTaskId = "";
    for (const { commitment, amountAtoms } of batch) {
      const settler = createOneShotSettler({
        permissionContext: commitment.permissionContext,
      });
      const { txHash } = await settler.settle({
        signedDelegation: commitment,
        payTo: this.#sellerAddress,
        atoms: amountAtoms,
      });
      lastTaskId = txHash;
    }
    return lastTaskId;
  }
}

/**
 * Count USDC Transfer(to=seller) log entries in a receipt — used by the proof to
 * assert that a single batch tx produced N transfers to the seller.
 */
export function countTransfersTo(
  logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[],
  seller: Address,
): number {
  let count = 0;
  for (const log of logs) {
    if (log.address.toLowerCase() !== USDC.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (
        decoded.eventName === "Transfer" &&
        (decoded.args as { to: Address }).to.toLowerCase() === seller.toLowerCase()
      ) {
        count++;
      }
    } catch {
      // not a Transfer event — skip
    }
  }
  return count;
}
