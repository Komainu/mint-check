import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // OpenSea（ERC-8257）のマニフェストの決まった場所。商品ごとに /.well-known/ai-tool/<slug>.json
      { source: "/.well-known/ai-tool/:slug.json", destination: "/api/manifest/:slug" },
      // x402 の検索サービス（x402scan など）が読む商品一覧
      { source: "/openapi.json", destination: "/api/discovery/openapi" },
      { source: "/.well-known/x402", destination: "/api/discovery/well-known" },
    ];
  },
};

export default nextConfig;
