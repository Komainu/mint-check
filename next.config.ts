import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // OpenSea（ERC-8257）のマニフェストの決まった場所
      { source: "/.well-known/ai-tool/mint-check.json", destination: "/api/manifest" },
    ];
  },
};

export default nextConfig;
