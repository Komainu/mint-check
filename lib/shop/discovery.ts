/**
 * 店の商品一覧を、x402 の検索サービス（x402scan など）が読む形で出す（v0.11、2026-11-21）。
 *   - /openapi.json       … OpenAPI 3。有料の各操作に x-payment-info と 402 応答を書く（x402scan の推奨）
 *   - /.well-known/x402   … 互換用。有料 URL の一覧だけ
 * どちらも PRODUCTS から作るので、商品を足せば自動で載る。商品の 402 やマニフェストには影響しない。
 */
import type { Product } from "./types";
import { productPath } from "./types";
import { PUBLIC_ORIGIN, manifestPath } from "./catalog";

/** "$0.02" → "0.02" */
export function priceToUsdString(price: string): string {
  const s = price.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`unsupported price: ${price}`);
  return s;
}

type JsonSchema = Record<string, unknown>;

function operation(p: Product, method: "get" | "post") {
  const props = p.bazaar.inputSchema.properties as Record<string, JsonSchema>;
  const required = new Set(p.bazaar.inputSchema.required ?? []);
  const input =
    method === "get"
      ? {
          parameters: Object.entries(props).map(([name, schema]) => ({
            name,
            in: "query",
            required: required.has(name),
            description: schema.description,
            schema: Object.fromEntries(Object.entries(schema).filter(([k]) => k !== "description")),
          })),
        }
      : {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", properties: props, required: [...required] },
                example: p.bazaar.inputExample,
              },
            },
          },
        };
  return {
    operationId: `${p.slug.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}${method === "get" ? "Get" : "Post"}`,
    summary: p.serviceName,
    description: p.description,
    tags: p.tags,
    ...input,
    "x-payment-info": {
      protocols: ["x402"],
      price: { mode: "fixed", currency: "USD", amount: priceToUsdString(p.price()) },
    },
    "x-erc8257-manifest": `${PUBLIC_ORIGIN}${manifestPath(p)}`,
    responses: {
      "200": {
        description: "Check result (JSON).",
        content: { "application/json": { example: p.bazaar.outputExample } },
      },
      "400": { description: "Invalid input. Not charged." },
      "402": { description: "Payment Required (x402 v2, PAYMENT-REQUIRED header)." },
      "502": { description: "Upstream failure. Not charged." },
    },
  };
}

export function buildOpenApi(products: readonly Product[], version: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "AI agent shop (x402) on Base",
      version,
      description:
        "Pay-per-call on-chain checks for agents on Base, paid in USDC via x402. Facts only; not audits or financial advice.",
    },
    servers: [{ url: PUBLIC_ORIGIN }],
    paths: Object.fromEntries(products.map(p => [productPath(p), { get: operation(p, "get"), post: operation(p, "post") }])),
  };
}

export function buildWellKnownX402(products: readonly Product[]) {
  return {
    version: 1,
    resources: products.map(p => `${PUBLIC_ORIGIN}${productPath(p)}`),
  };
}
