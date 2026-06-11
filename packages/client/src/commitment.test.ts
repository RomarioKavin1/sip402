import { describe, it, expect } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { isHex, type Address } from "viem";
import {
  createDelegation,
  ScopeType,
  getSmartAccountsEnvironment,
  type Delegation,
} from "@metamask/smart-accounts-kit";
import { decodeDelegations } from "@metamask/smart-accounts-kit/utils";
import { USDC, CHAIN_ID, toUsdcAtoms } from "@sip402/core";

import { createCommitment } from "./commitment.js";
import type { Session } from "./session.js";

/**
 * Pure (no-network) coverage of the commitment voucher construction:
 *   - createCommitment is a redelegation agent→seller (extends the chain),
 *   - permissionContext encodes the FULL chain leaf-first,
 *   - the canonical fields / commitmentId are well-formed and deterministic.
 *
 * The on-chain redemption is proven separately in scripts/binding-proof.ts on
 * Base Sepolia (real transactions).
 */
function makeSession(): Session {
  const env = getSmartAccountsEnvironment(CHAIN_ID);
  const treasury = privateKeyToAccount(generatePrivateKey()).address as Address;
  const agentPrivateKey = generatePrivateKey();
  const agent = privateKeyToAccount(agentPrivateKey);

  // A well-formed (unsigned-but-shaped) root delegation treasury→agent.
  const root = createDelegation({
    scope: {
      type: ScopeType.Erc20PeriodTransfer,
      tokenAddress: USDC,
      periodAmount: toUsdcAtoms(1),
      periodDuration: 86400,
      startDate: 1749470400,
    },
    to: agent.address,
    from: treasury,
    environment: env,
  });
  const rootSigned: Delegation = { ...root, signature: `0x${"00".repeat(65)}` };

  return {
    treasuryAddress: treasury,
    agentPrivateKey,
    agentAddress: agent.address,
    rootSignedDelegation: rootSigned,
    permissionContext: "0x",
    capAtoms: toUsdcAtoms(1),
    periodSeconds: 86400,
    startDate: 1749470400,
    chain: [rootSigned],
  };
}

describe("createCommitment", () => {
  it("builds a batch-settlement voucher that extends the chain agent→seller", async () => {
    const session = makeSession();
    const seller = privateKeyToAccount(generatePrivateKey()).address as Address;

    const c = await createCommitment({
      session,
      sellerAddress: seller,
      amountAtoms: toUsdcAtoms(0.1),
    });

    expect(c.scheme).toBe("batch-settlement");
    expect(c.network).toBe("eip155:84532");
    expect(c.delegator).toBe(session.treasuryAddress);
    expect(c.payTo).toBe(seller);
    expect(c.amount).toBe(toUsdcAtoms(0.1).toString());
    expect(isHex(c.nonce)).toBe(true);
    expect(isHex(c.commitmentId)).toBe(true);
    expect(c.commitmentId).toHaveLength(66); // keccak256 → 32 bytes
    expect(Number(c.validBefore)).toBeGreaterThan(Math.floor(Date.now() / 1000));

    // permissionContext decodes to the FULL chain, leaf-first:
    //   [0] agent→seller (the commitment leaf)
    //   [1] treasury→agent (the root)
    const decoded = decodeDelegations(c.permissionContext);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]!.delegate.toLowerCase()).toBe(seller.toLowerCase());
    expect(decoded[0]!.delegator.toLowerCase()).toBe(session.agentAddress.toLowerCase());
    expect(decoded[1]!.delegate.toLowerCase()).toBe(session.agentAddress.toLowerCase());
    expect(decoded[1]!.delegator.toLowerCase()).toBe(session.treasuryAddress.toLowerCase());
    // The commitment leaf is signed by the agent (65-byte ECDSA sig).
    expect(decoded[0]!.signature).toHaveLength(132);
  });

  it("rejects an amount exceeding the session cap", async () => {
    const session = makeSession();
    const seller = privateKeyToAccount(generatePrivateKey()).address as Address;
    await expect(
      createCommitment({ session, sellerAddress: seller, amountAtoms: toUsdcAtoms(2) }),
    ).rejects.toThrow(/exceeds session cap/);
  });

  it("gives distinct nonces/commitmentIds to repeat commitments (replay-safe)", async () => {
    const session = makeSession();
    const seller = privateKeyToAccount(generatePrivateKey()).address as Address;
    const a = await createCommitment({ session, sellerAddress: seller, amountAtoms: toUsdcAtoms(0.1) });
    const b = await createCommitment({ session, sellerAddress: seller, amountAtoms: toUsdcAtoms(0.1) });
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.commitmentId).not.toBe(b.commitmentId);
    // distinct salts → distinct leaf delegation hashes
    expect(decodeDelegations(a.permissionContext)[0]!.salt).not.toBe(
      decodeDelegations(b.permissionContext)[0]!.salt,
    );
  });
});
