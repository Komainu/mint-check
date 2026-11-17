import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // OpenSea（ERC-8257）のマニフェストの決まった場所。商品ごとに /.well-known/ai-tool/<slug>.json
      { source: "/.well-known/ai-tool/:slug.json", destination: "/api/manifest/:slug" },
    ];
  },
};

export default nextConfig;
