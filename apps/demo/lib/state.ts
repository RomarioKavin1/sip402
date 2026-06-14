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
}
