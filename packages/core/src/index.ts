/**
 * index.ts — public surface of @sip402/core (the seller / settlement side).
 *
 * Re-exports the four building blocks of the protocol's on-chain half:
 *   - chain.js    network + USDC + 1Shot config (selected by SIP_NETWORK)
 *   - session.js  SipMeter — pure draw-batching accounting against a session cap
 *   - settle.js   the Settler abstraction (DirectRedeem on testnet, OneShot on mainnet)
 *   - oneshot.js  the 1Shot gasless-relayer JSON-RPC client
 */
export const SIP402_VERSION = "0.1.1";

export * from "./chain.js";
export * from "./session.js";
export * from "./settle.js";
export * from "./oneshot.js";
