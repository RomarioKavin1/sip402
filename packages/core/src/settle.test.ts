/**
 * settle.test.ts — checks buildTransferExecution encodes a well-formed USDC
 * transfer(payTo, atoms) Execution against the configured USDC contract.
 */
import { describe, it, expect } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { buildTransferExecution } from "./settle.js";
import { USDC } from "./chain.js";

describe("buildTransferExecution", () => {
  const recipient = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" as const;
  const atoms = 300000n; // $0.30

  it("targets the USDC contract from chain.ts", () => {
    const exec = buildTransferExecution(recipient, atoms);
    expect(exec.target).toBe(USDC);
  });

  it("sets value to 0n (ERC20 transfer, no ETH)", () => {
    const exec = buildTransferExecution(recipient, atoms);
    expect(exec.value).toBe(0n);
  });

  it("encodes the ERC20 transfer function selector (0xa9059cbb)", () => {
    const exec = buildTransferExecution(recipient, atoms);
    // ERC20 transfer(address,uint256) selector = 0xa9059cbb
    expect(exec.callData.slice(0, 10)).toBe("0xa9059cbb");
  });

  it("encodes the correct recipient address and amount", () => {
    const exec = buildTransferExecution(recipient, atoms);
    const decoded = decodeFunctionData({
      abi: erc20Abi,
      data: exec.callData,
    });
    expect(decoded.functionName).toBe("transfer");
    const [to, value] = decoded.args as [string, bigint];
    expect(to.toLowerCase()).toBe(recipient.toLowerCase());
    expect(value).toBe(atoms);
  });

  it("produces a non-empty hex callData string starting with 0x", () => {
    const exec = buildTransferExecution(recipient, atoms);
    expect(exec.callData.startsWith("0x")).toBe(true);
    expect(exec.callData.length).toBeGreaterThan(10);
  });
});
