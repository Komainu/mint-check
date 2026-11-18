/**
 * 2号商品: x402 Seller Check（知らない x402 の店に払う前の点検）
 * 企画: 商品台帳（Notion）「x402 Seller Check」の行。2026-11-18 採点 20/25。
 * 公開後に説明・タグ・入出力・価格を変えたら manifest.version を上げ、OpenSea の記録も更新すること。
 */
import type { Product } from "@/lib/shop/types";
import { makeClients, runSellerCheck } from "./checks";
import { httpsProber, validateTargetUrl } from "./probe";

export const x402SellerCheck: Product = {
  slug: "x402-seller-check",
  serviceName: "x402 Seller Check",
  description:
    "Check an x402 endpoint before you pay it. Makes one unpaid request and decodes the 402 (v1 or v2): price in USD, network, asset, payTo (EOA, EIP-7702 or contract), timeout. Flags issues that make payments fail: EIP-712 name/version not matching the token on Base, description over the CDP 500-char limit, wrong resource URL, missing Bazaar metadata. Never signs or pays. Not a judgment of the seller's honesty.",
  tags: ["x402", "x402-check", "seller-check", "pre-payment-check", "base"],
  price: () => process.env.SELLER_CHECK_PRICE || "$0.01",

  bazaar: {
    inputExample: { url: "https://mint-check.vercel.app/api/mint-check", method: "GET" },
    inputSchema: {
      properties: {
        url: {
          type: "string",
          description: "Absolute https URL of the paid endpoint to check (port 443).",
          pattern: "^https://",
        },
        method: {
          type: "string",
          description: "Optional. GET (default) or POST. POST sends an empty JSON object.",
          enum: ["GET", "POST"],
        },
      },
      required: ["url"],
    },
    outputExample: {
      url: "https://example.com/api/report",
      method: "GET",
      result: "has_problems",
      summary: { pass: 4, warn: 1, fail: 1, info: 0 },
      http: { status: 402, latencyMs: 412, redirectTo: null },
      x402: { version: 2, source: "header" },
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          assetLabel: "USDC on Base",
          amountAtomic: "10000",
          priceUsd: 0.01,
          payToKind: "contract",
          eip712: { declared: { name: "USDC", version: "2" }, onchain: { name: "USD Coin", version: "2" }, match: false },
        },
      ],
      checks: [
        {
          id: "accepts[0].eip712",
          status: "fail",
          message: 'extra says "USDC" / "2" but the token\'s EIP-712 domain is "USD Coin" / "2". Signatures will not verify.',
        },
      ],
      notMeasured: [{ item: "delivery_after_payment", reason: "This check never pays." }],
    },
  },

  manifest: {
    version: "0.1.0",
    inputs: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute https URL of the paid endpoint to check.", pattern: "^https://" },
        method: { type: "string", description: "Optional. GET (default) or POST.", enum: ["GET", "POST"] },
      },
      required: ["url"],
    },
    outputs: {
      type: "object",
      properties: {
        url: { type: "string" },
        checkedAt: { type: "string" },
        result: { type: "string", description: "payable, payable_with_warnings, has_problems or not_payable." },
        summary: { type: "object", description: "Counts of pass, warn, fail and info checks." },
        http: { type: "object", description: "Status, latency and redirect of the unpaid request." },
        x402: { type: "object", description: "x402 version and where the requirements were found." },
        resource: { type: "object", description: "Resource URL, description, serviceName and tags as declared." },
        accepts: { type: "array", items: { type: "object" }, description: "Each payment option with USD price, payTo kind and EIP-712 match." },
        bazaar: { type: "object", description: "Whether Bazaar discovery metadata is present." },
        checks: { type: "array", items: { type: "object" } },
        notMeasured: { type: "array", items: { type: "object" } },
        disclaimer: { type: "string" },
      },
    },
  },

  async run(input) {
    const target = validateTargetUrl(input.url);
    if ("error" in target) return { status: 400, body: { error: `${target.error} You were not charged.` } };
    const m = (input.method ?? "GET").toUpperCase();
    if (m !== "GET" && m !== "POST") return { status: 400, body: { error: "method must be GET or POST. You were not charged." } };
    const out = await runSellerCheck(target.url, m, { prober: httpsProber, clients: makeClients() });
    if (out.unreachable) {
      return { status: 502, body: { error: `Could not reach the endpoint: ${out.reason}. You were not charged.` } };
    }
    return { status: 200, body: out.body };
  },
};
