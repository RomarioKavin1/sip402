import type { Session } from "@sip402/client";
import type { Hex } from "viem";

export interface DemoState {
  session: Session | null;
  writerSession: Session | null;
  illustratorSession: Session | null;
  sellerPrivateKey: Hex | null;
  sellerAddress: string | null;
  writerDrawn: bigint;
  illustratorDrawn: bigint;
  totalDrawn: bigint;
  running: boolean;
  writerText: string;
  illustratorText: string;
  writerRevoked: boolean;
  illustratorRevoked: boolean;
  // Mainnet-specific: agent address (funded EOA) + budget
  mainnetAgent: string | null;
  mainnetBudgetUsd: number;
  // ── Testnet MetaMask ERC-7715 grant flow ──────────────────────────────────
  /** Server-generated session keypair (the delegate the agent uses). */
  sessionPrivateKey: Hex | null;
  sessionAddress: string | null;
  /** The MetaMask-granted ROOT permission context (the signed delegation chain). */
  grantContext: Hex | null;
  /** The granting smart account (delegator / root `from`) returned by the grant. */
  grantFrom: string | null;
  /** Delegation manager the grant must be redeemed through. */
  grantDelegationManager: string | null;
  /**
   * Deploy dependencies for the granting smart account (if counterfactual).
   * Each entry deploys a contract the granted chain depends on before first redeem.
   */
  grantDependencies: { factory: string; factoryData: string }[];
  /** Total atoms drawn against the granted budget this run. */
  grantDrawn: bigint;
}

const g = globalThis as typeof globalThis & { __sip402Demo?: DemoState };

if (!g.__sip402Demo) {
  g.__sip402Demo = {
    session: null,
    writerSession: null,
    illustratorSession: null,
    sellerPrivateKey: null,
    sellerAddress: null,
    writerDrawn: 0n,
    illustratorDrawn: 0n,
    totalDrawn: 0n,
    running: false,
    writerText: "",
    illustratorText: "",
    writerRevoked: false,
    illustratorRevoked: false,
    mainnetAgent: null,
    mainnetBudgetUsd: 0,
    sessionPrivateKey: null,
    sessionAddress: null,
    grantContext: null,
    grantFrom: null,
    grantDelegationManager: null,
    grantDependencies: [],
    grantDrawn: 0n,
  };
}

export const state = g.__sip402Demo!;

export function resetState() {
  const s = state;
  s.session = null;
  s.writerSession = null;
  s.illustratorSession = null;
  s.sellerPrivateKey = null;
  s.sellerAddress = null;
  s.writerDrawn = 0n;
  s.illustratorDrawn = 0n;
  s.totalDrawn = 0n;
  s.running = false;
  s.writerText = "";
  s.illustratorText = "";
  s.writerRevoked = false;
  s.illustratorRevoked = false;
  s.mainnetAgent = null;
  s.mainnetBudgetUsd = 0;
  s.sessionPrivateKey = null;
  s.sessionAddress = null;
  s.grantContext = null;
  s.grantFrom = null;
  s.grantDelegationManager = null;
  s.grantDependencies = [];
  s.grantDrawn = 0n;
}
