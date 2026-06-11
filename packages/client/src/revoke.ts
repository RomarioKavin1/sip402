/**
 * revoke.ts — revokeSession: disable the root delegation on-chain.
 *
 * `DelegationManager.disableDelegation(_delegation)` requires
 * `msg.sender == _delegation.delegator` (the treasury smart account). The
 * treasury's `execute(...)` is `onlyEntryPointOrSelf`, so the owner EOA cannot
 * call it directly. Without relying on a third-party bundler we therefore drive
 * the treasury through the ERC-4337 EntryPoint ourselves:
 *
 *   1. Build callData = treasury.execute(Execution{
 *        target: DelegationManager, value: 0, callData: disableDelegation(root) }).
 *   2. Wrap it in a UserOperation, signed by the treasury (owner is the signer).
 *   3. Ensure the treasury has a small ETH balance to cover the EntryPoint
 *      prefund, then self-submit via EntryPoint.handleOps([userOp], owner) —
 *      the OWNER acts as the bundler/beneficiary and pays the L1 gas.
 *
 * Inside the userOp, the treasury is `msg.sender` of the inner disableDelegation
 * call, satisfying the delegator check. Afterwards any redemption of a chain
 * rooted in this delegation reverts.
 */

import {
  encodeFunctionData,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  entryPoint07Abi,
  entryPoint07Address,
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from "viem/account-abstraction";
import {
  toMetaMaskSmartAccount,
  Implementation,
  contracts,
  type Delegation,
} from "@metamask/smart-accounts-kit";

import { DEFAULT_RPC_URL } from "@sip402/core";
import { env, chainId, publicClientFor, walletClientFor } from "./internal.js";
import type { Session } from "./session.js";

export async function revokeSession(opts: {
  session: Session;
  ownerPrivateKey: Hex;
  rpcUrl?: string;
}): Promise<{ txHash: string }> {
  const { session, ownerPrivateKey, rpcUrl = DEFAULT_RPC_URL } = opts;

  const publicClient = publicClientFor(rpcUrl);
  const owner = privateKeyToAccount(ownerPrivateKey);
  const ownerWallet = walletClientFor(owner, rpcUrl);
  const e = env();
  const entryPoint = (e.EntryPoint as Address) ?? entryPoint07Address;

  const root = session.rootSignedDelegation as Delegation;

  // Inner call: DelegationManager.disableDelegation(root).
  const disableCalldata = contracts.DelegationManager.encode.disableDelegation({
    delegation: root,
  });

  // Reconstruct the treasury smart account (owner is the signer).
  const treasury = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [owner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: owner },
  });

  // userOp callData = treasury.execute([{ to: DelegationManager, data: disable }]).
  const callData = await treasury.encodeCalls([
    { to: e.DelegationManager as Address, value: 0n, data: disableCalldata },
  ]);

  // Ensure the treasury can cover the EntryPoint prefund (it has no deposit).
  const treasuryEth = await publicClient.getBalance({ address: treasury.address });
  if (treasuryEth < parseEther("0.002")) {
    const topUp = await ownerWallet.sendTransaction({
      to: treasury.address,
      value: parseEther("0.003"),
      chain: undefined,
      account: owner,
    });
    await publicClient.waitForTransactionReceipt({ hash: topUp });
  }

  // Assemble + sign the UserOperation (account already deployed → no factory).
  const nonce = await treasury.getNonce();
  const fees = await publicClient.estimateFeesPerGas();
  const maxPriorityFeePerGas = fees.maxPriorityFeePerGas ?? parseEther("0.0000000015");
  const maxFeePerGas = fees.maxFeePerGas ?? parseEther("0.000000003");

  const unsigned: UserOperation<"0.7"> = {
    sender: treasury.address,
    nonce,
    callData,
    callGasLimit: 300_000n,
    verificationGasLimit: 500_000n,
    preVerificationGas: 100_000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
    signature: "0x",
  };

  const signature = await treasury.signUserOperation(unsigned);
  const signed: UserOperation<"0.7"> = { ...unsigned, signature };

  // Sanity: confirm the userOp hash is well-formed (and ties to this chain).
  getUserOperationHash({ chainId, entryPointAddress: entryPoint, entryPointVersion: "0.7", userOperation: signed });

  const packed = toPackedUserOperation(signed);

  // Self-submit via EntryPoint.handleOps — owner is the bundler/beneficiary.
  const txHash = await ownerWallet.sendTransaction({
    to: entryPoint,
    data: encodeFunctionData({
      abi: entryPoint07Abi,
      functionName: "handleOps",
      args: [[packed], owner.address],
    }),
    chain: undefined,
    account: owner,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === "reverted") {
    throw new Error(`revokeSession handleOps tx reverted: ${txHash}`);
  }
  return { txHash };
}
