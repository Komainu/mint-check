/**
 * 商品から、カタログ（Bazaar）用のルート設定と、OpenSea（ERC-8257）用のマニフェストを作る。
 *
 * 注意: マニフェストの中身から計算したハッシュがオンチェーンに記録される。
 * 項目の並び順や値を変えるとハッシュが変わるので、既存商品の出力は変えないこと
 * （scripts/shop-test.ts が登録済みのハッシュと照合する）。
 */
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { getPaymentSettings } from "./payment";
import { productPath, type Product } from "./types";

/** 公開URLの起点。マニフェストとAPIは同じ起点で配信する必要がある */
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://mint-check.vercel.app";

/** OpenSea への登録に使うウォレット（Base Account）。オンチェーンの creator と一致させる。小文字必須 */
export const CREATOR_ADDRESS = (
  process.env.TOOL_CREATOR_ADDRESS || "0xe0f8476aee274ca1dd3176949d5c277350a96238"
).toLowerCase();

const USDC_BY_NETWORK: Record<string, string> = {
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
};

export function manifestPath(product: Pick<Product, "slug">): string {
  return `/.well-known/ai-tool/${product.slug}.json`;
}

/** "$0.02" → "20000"（USDC は小数6桁） */
export function priceToBaseUnits(price: string): string {
  const m = /^\$?(\d+)(?:\.(\d{1,6}))?$/.exec(price.trim());
  if (!m) throw new Error(`価格の形式が読めません: ${price}`);
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(6, "0"));
  return (whole * 1_000_000n + frac).toString();
}

/** x402 の料金所に渡すルート設定（Bazaar の掲載情報を含む） */
export function buildRouteConfig(product: Product) {
  const { payTo, network } = getPaymentSettings();
  return {
    accepts: [{ scheme: "exact" as const, price: product.price(), network, payTo }],
    serviceName: product.serviceName,
    tags: product.tags,
    description: product.description,
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: product.bazaar.inputExample,
        inputSchema: product.bazaar.inputSchema,
        output: { example: product.bazaar.outputExample },
      }),
    },
  };
}

/** パス付きで登録する（ワイルドカードにしない） */
export function buildRoutes(product: Product) {
  return { [productPath(product)]: buildRouteConfig(product) };
}

/** OpenSea（ERC-8257）用のマニフェスト */
export function buildManifest(product: Product) {
  const { payTo, network } = getPaymentSettings();
  const asset = USDC_BY_NETWORK[network];
  if (!asset) throw new Error(`未対応のネットワークです: ${network}`);

  return {
    type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
    name: product.serviceName,
    description: product.description,
    version: product.manifest.version,
    endpoint: `${PUBLIC_ORIGIN}${productPath(product)}`,
    tags: product.tags,
    inputs: product.manifest.inputs,
    outputs: product.manifest.outputs,
    creatorAddress: CREATOR_ADDRESS,
    pricing: [
      {
        amount: priceToBaseUnits(product.price()),
        asset: `${network}/erc20:${asset}`,
        recipient: `${network}:${payTo.toLowerCase()}`,
        protocol: "x402",
      },
    ],
  };
}
