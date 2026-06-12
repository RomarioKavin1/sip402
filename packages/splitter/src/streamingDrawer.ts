/**
 * streamingDrawer.ts — incremental per-batch on-chain USDC draws.
 *
 * The heart of the splitter: as tokens are delivered, their cost is recorded.
 * When the accrued cost reaches minBatchAtoms, a real redeemDelegations
 * transaction is submitted against the buyer's commitment — drawing that batch
 * to the seller's EOA on Base (testnet: Sepolia; mainnet: Base).
 *
 * One commitment authorizes up to maxAmount; we redeem it many times
 * (each call accumulates against the ERC20PeriodTransferEnforcer cap).
 * When a draw reverts (cap reached / commitment revoked), we surface a
 * DRY_TAB error so the caller can halt the stream.
 *
 * Uses SipMeter for batch accounting and createDirectRedeemSettler for on-chain
 * draws (testnet). On mainnet, substitute createOneShotSettler in the factory.
 */

import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  createDirectRedeemSettler,
  DEFAULT_RPC_URL,
  IS_MAINNET,
} from "@sip402/core";
import type { Commitment } from "@sip402/client";
import type { SettlementEvent } from "@sip402/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DrawerOpts {
  /** Seller's EOA private key — msg.sender for redemptions, also payTo. */
  sellerPrivateKey: Hex;
  /** The buyer's commitment (the redelegation-to-seller chain). */
  commitment: Commitment;
  /** Minimum accrued cost (atoms) before triggering an on-chain draw. */
  minBatchAtoms: bigint;
  /** Optional RPC URL override. */
  rpcUrl?: string;
  /** Called after every successful (or failed) draw. */
  onEvent?: (e: SettlementEvent) => void;
  /**
   * Injectable settler for unit tests.
   * In production (undefined) a DirectRedeemSettler is created automatically.
   */
  _settler?: {
    settle(args: {
      signedDelegation: unknown;
      payTo: Address;
      atoms: bigint;
    }): Promise<{ txHash: string }>;
  };
}

export class DryTabError extends Error {
  readonly txHash?: string;
  constructor(message: string, txHash?: string) {
    super(message);
    this.name = "DryTabError";
    this.txHash = txHash;
  }
}

// ---------------------------------------------------------------------------
// StreamingDrawer
// ---------------------------------------------------------------------------

/**
 * Records token costs and issues incremental on-chain draws as batches fill.
 *
 * Usage:
 *   const drawer = new StreamingDrawer({ sellerPrivateKey, commitment, minBatchAtoms });
 *   for await (const chunk of upstream.chatStream(...)) {
 *     const event = await drawer.record(tokenCostAtoms(chunk.tokens));
 *     if (event) console.log("drew", event.amountAtoms, "tx:", event.txHash);
 *   }
 *   await drawer.finalize(); // flush any remainder
 */
export class StreamingDrawer {
  readonly #sellerPrivateKey: Hex;
  readonly #sellerAddress: Address;
  readonly #commitment: Commitment;
  readonly #rpcUrl: string;
  readonly #onEvent?: (e: SettlementEvent) => void;
  readonly #settler: DrawerOpts["_settler"];

  /** The commitment cap — the authoritative ceiling for this drawer. */
  readonly #cap: bigint;
  /** Minimum accrued cost before triggering an on-chain draw. */
  readonly #minBatch: bigint;

  /** Cost accrued but not yet drawn on-chain. */
  #owed = 0n;
  /** Total atoms CONFIRMED drawn on-chain (only advanced after a successful tx). */
  #drawn = 0n;
  /** True once a draw has reverted / the cap is reached — no further draws. */
  #dry = false;

  constructor(opts: DrawerOpts) {
    this.#sellerPrivateKey = opts.sellerPrivateKey;
    this.#sellerAddress = privateKeyToAccount(opts.sellerPrivateKey).address;
    this.#commitment = opts.commitment;
    this.#rpcUrl = opts.rpcUrl ?? DEFAULT_RPC_URL;
    this.#onEvent = opts.onEvent;
    this.#settler = opts._settler;
    this.#cap = BigInt(opts.commitment.amount);
    this.#minBatch = opts.minBatchAtoms;
  }

  /** Total atoms CONFIRMED drawn on-chain so far. */
  get drawn(): bigint {
    return this.#drawn;
  }

  /** True after a dry-tab revert — no more draws will succeed. */
  get isDry(): boolean {
    return this.#dry;
  }

  /**
   * Record the cost of a token chunk. When the accrued cost reaches minBatch,
   * issues an on-chain draw and returns a SettlementEvent. Returns null if the
   * batch is not yet full. Throws DryTabError if a draw reverts.
   */
  async record(costAtoms: bigint): Promise<SettlementEvent | null> {
    if (this.#dry) throw new DryTabError("session dry — drawer halted");
    if (costAtoms === 0n) return null;
    this.#owed += costAtoms;
    if (this.#owed < this.#minBatch) return null;
    return this.#drawBatch();
  }

  /**
   * Flush any accrued but un-drawn remainder. Call at end of stream to ensure
   * the final partial batch is settled. Returns a SettlementEvent or null.
   */
  async finalize(): Promise<SettlementEvent | null> {
    if (this.#dry || this.#owed === 0n) return null;
    return this.#drawBatch();
  }

  // ── Private: issue one on-chain draw ─────────────────────────────────────
  //
  // Draws min(owed, remaining-budget). Accounting (#owed/#drawn) is committed
  // ONLY after the on-chain tx confirms — a reverted draw never counts.

  async #drawBatch(): Promise<SettlementEvent> {
    const remaining = this.#cap - this.#drawn;
    const batchAtoms = this.#owed < remaining ? this.#owed : remaining;
    if (batchAtoms <= 0n) {
      this.#dry = true;
      throw new DryTabError("commitment cap exhausted");
    }

    const settler = this.#settler ?? this.#makeSettler();

    let txHash: string;
    try {
      const result = await settler.settle({
        signedDelegation: this.#commitment.permissionContext,
        payTo: this.#sellerAddress,
        atoms: batchAtoms,
      });
      txHash = result.txHash;
    } catch (err) {
      this.#dry = true;
      const message = err instanceof Error ? err.message : String(err);
      // Emit a failed-settle event so listeners can observe the dry-tab.
      this.#onEvent?.({
        type: "settle",
        commitmentIds: [this.#commitment.commitmentId],
        amountAtoms: batchAtoms,
        txHash: undefined,
        at: Date.now(),
      });
      throw new DryTabError(`draw reverted: ${message}`);
    }

    // Commit accounting only after on-chain success.
    this.#owed -= batchAtoms;
    this.#drawn += batchAtoms;

    const event: SettlementEvent = {
      type: "settle",
      commitmentIds: [this.#commitment.commitmentId],
      amountAtoms: batchAtoms,
      txHash,
      at: Date.now(),
    };
    this.#onEvent?.(event);
    return event;
  }

  #makeSettler() {
    if (IS_MAINNET) {
      // On mainnet, use OneShotSettler (relayer, gasless USDC).
      // Import lazily so testnet builds don't require relayer config.
      // For now we throw — mainnet wiring is done tomorrow.
      throw new Error(
        "StreamingDrawer on mainnet requires OneShotSettler — wire createOneShotSettler() here " +
          "when switching to mainnet. On testnet, DirectRedeemSettler is used automatically.",
      );
    }
    return createDirectRedeemSettler({
      delegateAccount: privateKeyToAccount(this.#sellerPrivateKey),
      rpcUrl: this.#rpcUrl,
    });
  }
}
