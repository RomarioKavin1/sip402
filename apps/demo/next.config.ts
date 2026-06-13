import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@sip402/core",
    "@sip402/client",
    "@sip402/server",
    "@sip402/splitter",
  ],
  serverExternalPackages: ["viem", "@metamask/smart-accounts-kit"],
};

export default nextConfig;
