/**
 * @sip402/splitter — Venice AI inference reseller, billed per token via sip402.
 *
 * Public API:
 *   upstream.ts   — Upstream interface + veniceUpstream / localUpstream factories
 *   pricing.ts    — USDC_PER_1K_TOKENS + tokenCostAtoms()
 *   streamingDrawer.ts — StreamingDrawer (per-batch incremental on-chain draws)
 *   gateway.ts    — makeGateway() Hono factory + COMMITMENT_HEADER constants
 */

export type { Upstream, UpstreamChunk, UpstreamRequest } from "./upstream.js";
export { veniceUpstream, localUpstream } from "./upstream.js";

export { USDC_PER_1K_TOKENS, ATOMS_PER_TOKEN, tokenCostAtoms } from "./pricing.js";

export { StreamingDrawer, DryTabError } from "./streamingDrawer.js";
export type { DrawerOpts } from "./streamingDrawer.js";

export {
  makeGateway,
  COMMITMENT_HEADER,
  COMMITMENT_HEADER_ALT,
} from "./gateway.js";
export type { GatewayOpts } from "./gateway.js";
