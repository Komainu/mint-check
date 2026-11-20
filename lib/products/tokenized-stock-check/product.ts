/**
 * 3号商品: Tokenized Stock Check（Base のトークン化米国株の点検）
 * 企画: 商品台帳（Notion）「Tokenized Stock Check」の行。2026-11-20 採点 19/25、試作。
 * 公開後に説明・タグ・入出力・価格を変えたら manifest.version を上げ、OpenSea の記録も更新すること。
 */
import type { Product } from "@/lib/shop/types";
import { isValidAddress, makeClient } from "../mint-check/checks";
import { runStockCheck } from "./checks";

export const tokenizedStockCheck: Product = {
  slug: "tokenized-stock-check",
  serviceName: "Tokenized Stock Check",
  description:
    "Check a tokenized US stock on Base before you trade or lend against it. Coinbase (B20) and Dinari tokens: is anything paused, can the issuer block or seize balances and who holds that key, can the logic be upgraded, dividend multiplier, Chainlink price and its age, and whether the US market is open (on-chain prices hold the last close). Lists what could not be measured. Not investment advice.",
  tags: ["tokenized-stocks", "rwa", "equities", "base", "pre-trade-check"],
  price: () => process.env.STOCK_CHECK_PRICE || "$0.01",

  bazaar: {
    inputExample: { address: "0xb20000000000000000000078ee7ce2fE4908108C" },
    inputSchema: {
      properties: {
        address: {
          type: "string",
          description: "Tokenized stock contract on Base (0x-prefixed, 40 hex characters), e.g. NVDAc.",
          pattern: "^0x[0-9a-fA-F]{40}$",
        },
      },
      required: ["address"],
    },
    outputExample: {
      issuer: "coinbase_b20",
      token: { name: "NVIDIA", symbol: "NVDAc", decimals: 8, totalSupply: "59119.04" },
      status: { pausedFeatures: [] },
      controls: {
        supplyCap: "uncapped",
        dividendMultiplier: 1.0011,
        transferSenderPolicy: { policyId: "5", openByDefault: true, adminKind: "single_key" },
        seizePolicy: { policyId: "129" },
      },
      price: { source: "chainlink", answerUsd: 143.54, ageSeconds: 3600 },
      market: { open: false, session: "closed" },
      flags: [
        { code: "ISSUER_CAN_BLOCK_ADDRESSES", note: "TRANSFER_SENDER_POLICY: policy 5 can block individual addresses from transferring." },
        { code: "SEIZE_CONFIGURED", note: "Seize is configured (policy 129)." },
      ],
      notMeasured: [{ item: "controls.roles", reason: "B20 roles cannot be listed on-chain." }],
    },
  },

  manifest: {
    version: "0.1.0",
    inputs: {
      type: "object",
      properties: {
        address: { type: "string", description: "Tokenized stock contract on Base.", pattern: "^0x[0-9a-fA-F]{40}$" },
      },
      required: ["address"],
    },
    outputs: {
      type: "object",
      properties: {
        address: { type: "string" },
        checkedAt: { type: "string" },
        issuer: { type: "string", description: "coinbase_b20, dinari or unknown." },
        token: { type: "object", description: "Name, symbol, decimals, total supply." },
        status: { type: "object", description: "Paused features or paused flag right now." },
        controls: { type: "object", description: "Block/seize policies and their admin kind, upgrade key, supply cap, multiplier." },
        price: { type: "object", description: "Chainlink price, update time and age (Coinbase tokens)." },
        market: { type: "object", description: "Whether the US equity market is open now." },
        flags: { type: "array", items: { type: "object" } },
        notMeasured: { type: "array", items: { type: "object" } },
        disclaimer: { type: "string" },
      },
    },
  },

  async run(input) {
    if (!isValidAddress(input.address)) {
      return { status: 400, body: { error: "address is required: a 0x-prefixed 40-hex contract address on Base. You were not charged." } };
    }
    try {
      const body = await runStockCheck(input.address, { client: makeClient(process.env.BASE_RPC_URL) });
      return { status: 200, body };
    } catch {
      return { status: 502, body: { error: "Upstream RPC failed. You were not charged." } };
    }
  },
};
