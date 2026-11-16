/**
 * OpenSea のツール登録（ERC-8257）用のマニフェスト。
 * /.well-known/ai-tool/mint-check.json で公開する（next.config.ts の書き換え設定を参照）。
 *
 * 注意: このマニフェストの中身から計算したハッシュがオンチェーンに記録される。
 * 登録後に中身（環境変数 PAY_TO・X402_NETWORK・PRICE を含む）を変えたら、
 * オンチェーンの記録も更新（update-metadata）しないと、利用者側の検証で不一致になる。
 */
import { ROUTE_DESCRIPTION, ROUTE_PATH, SERVICE_TAGS, getPaymentSettings } from "./x402";

/** 公開URLの起点。マニフェストとAPIは同じ起点で配信する必要がある */
export const PUBLIC_ORIGIN = process.env.PUBLIC_ORIGIN || "https://mint-check.vercel.app";

/** 登録に使うウォレット（Base Account）。オンチェーンの creator と一致させる。小文字必須 */
export const CREATOR_ADDRESS = (
  process.env.TOOL_CREATOR_ADDRESS || "0xe0f8476aee274ca1dd3176949d5c277350a96238"
).toLowerCase();

export const TOOL_SLUG = "mint-check";
export const MANIFEST_PATH = `/.well-known/ai-tool/${TOOL_SLUG}.json`;

const USDC_BY_NETWORK: Record<string, string> = {
  "eip155:8453": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "eip155:84532": "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
};

/** "$0.02" → "20000"（USDC は小数6桁） */
export function priceToBaseUnits(price: string): string {
  const m = /^\$?(\d+)(?:\.(\d{1,6}))?$/.exec(price.trim());
  if (!m) throw new Error(`PRICE の形式が読めません: ${price}`);
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(6, "0"));
  return (whole * 1_000_000n + frac).toString();
}

export function buildManifest() {
  const { payTo, network, price } = getPaymentSettings();
  const asset = USDC_BY_NETWORK[network];
  if (!asset) throw new Error(`未対応のネットワークです: ${network}`);
  const chainRef = network; // 例: eip155:8453

  return {
    type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
    name: "Mint Check",
    description: ROUTE_DESCRIPTION,
    version: "0.5.0",
    endpoint: `${PUBLIC_ORIGIN}${ROUTE_PATH}`,
    tags: SERVICE_TAGS,
    inputs: {
      type: "object",
      properties: {
        address: {
          type: "string",
          description: "NFT contract address on Base (0x-prefixed, 40 hex characters).",
          pattern: "^0x[0-9a-fA-F]{40}$",
        },
        tokenId: {
          type: "string",
          description: "Optional. Token id as a decimal string. ERC-1155 keeps supply per token.",
          pattern: "^[0-9]+$",
        },
      },
      required: ["address"],
    },
    outputs: {
      type: "object",
      properties: {
        address: { type: "string" },
        chain: { type: "string" },
        checkedAt: { type: "string" },
        basics: { type: "object", description: "Standard (ERC-721/1155), name, symbol, deployer." },
        code: { type: "object", description: "Verified source, proxy kind and implementation." },
        control: { type: "object", description: "Owner and its kind; Safe threshold if multisig." },
        mint: { type: "object", description: "Supply, max supply, known drop type (SeaDrop/thirdweb)." },
        capabilities: { type: "object", description: "Owner functions found: metadata, supply/price, pause, withdraw, owner mint." },
        flags: { type: "array", items: { type: "object" } },
        notMeasured: { type: "array", items: { type: "object" } },
        disclaimer: { type: "string" },
      },
    },
    creatorAddress: CREATOR_ADDRESS,
    pricing: [
      {
        amount: priceToBaseUnits(price),
        asset: `${chainRef}/erc20:${asset}`,
        recipient: `${chainRef}:${payTo.toLowerCase()}`,
        protocol: "x402",
      },
    ],
  };
}
