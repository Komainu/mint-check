/**
 * 店全体で共通の料金所の設定。
 * 環境変数だけで「練習用（Base Sepolia）」と「本番（Base）」、
 * 「練習用ファシリテーター」と「Coinbase（CDP）のファシリテーター」を切り替えられる。
 */
import { x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";
import { installFacilitatorLogging } from "./facilitator-log";
import { attachSalesLog } from "./sales-log";

export type Network = `${string}:${string}`;

const BASE_MAINNET = "eip155:8453";
const TESTNET_FACILITATOR = "https://x402.org/facilitator";

export function getPaymentSettings() {
  const payTo = process.env.PAY_TO;
  if (!payTo || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new Error("PAY_TO が未設定です。売上を受け取るアドレスを環境変数に入れてください。");
  }
  const cdpKeyId = process.env.CDP_API_KEY_ID?.trim();
  const cdpKeySecret = process.env.CDP_API_KEY_SECRET?.trim();
  const useCdp = Boolean(cdpKeyId && cdpKeySecret);
  if (Boolean(cdpKeyId) !== Boolean(cdpKeySecret)) {
    throw new Error("CDP_API_KEY_ID と CDP_API_KEY_SECRET は両方とも設定してください。");
  }

  const network = (process.env.X402_NETWORK || "eip155:84532") as Network;
  const facilitatorUrl = process.env.FACILITATOR_URL || TESTNET_FACILITATOR;
  if (network === BASE_MAINNET && !useCdp && facilitatorUrl === TESTNET_FACILITATOR) {
    throw new Error(
      "本番（eip155:8453）では練習用ファシリテーターは使えません。CDP_API_KEY_ID と CDP_API_KEY_SECRET を設定してください。",
    );
  }

  return {
    payTo,
    network,
    facilitator: useCdp
      ? { kind: "cdp" as const, keyId: cdpKeyId!, keySecret: cdpKeySecret! }
      : { kind: "url" as const, url: facilitatorUrl },
  };
}

/** 料金所。店の全商品で1つを共有する */
export function buildResourceServer() {
  installFacilitatorLogging();
  const { network, facilitator } = getPaymentSettings();
  const client =
    facilitator.kind === "cdp"
      ? new HTTPFacilitatorClient(createFacilitatorConfig(facilitator.keyId, facilitator.keySecret))
      : new HTTPFacilitatorClient({ url: facilitator.url });
  const server = new x402ResourceServer(client).register(network, new ExactEvmScheme());
  // Bazaar（カタログ）に載るための拡張。CDPのファシリテーターで決済が通ると自動で掲載される
  server.registerExtension(bazaarResourceServerExtension);
  // 決済が成立するたびに Notion の売上記録へ1行書く（NOTION_TOKEN があるときだけ）
  attachSalesLog(server);
  return server;
}

let shared: ReturnType<typeof buildResourceServer> | null = null;
export function sharedResourceServer() {
  if (!shared) shared = buildResourceServer();
  return shared;
}
