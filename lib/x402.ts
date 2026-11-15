/**
 * 料金所の設定。
 * 環境変数だけで「練習用（Base Sepolia）」と「本番（Base）」、
 * 「練習用ファシリテーター」と「Coinbase（CDP）のファシリテーター」を切り替えられる。
 */
import { x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";

type Network = `${string}:${string}`;

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
    price: process.env.PRICE || "$0.02",
    facilitator: useCdp
      ? { kind: "cdp" as const, keyId: cdpKeyId!, keySecret: cdpKeySecret! }
      : { kind: "url" as const, url: facilitatorUrl },
  };
}

export function buildResourceServer() {
  const { network, facilitator } = getPaymentSettings();
  const client =
    facilitator.kind === "cdp"
      ? new HTTPFacilitatorClient(createFacilitatorConfig(facilitator.keyId, facilitator.keySecret))
      : new HTTPFacilitatorClient({ url: facilitator.url });
  const server = new x402ResourceServer(client).register(network, new ExactEvmScheme());
  // Bazaar（カタログ）に載るための拡張。CDPのファシリテーターで決済が通ると自動で掲載される
  server.registerExtension(bazaarResourceServerExtension);
  return server;
}

/** カタログに表示される説明・入力例・出力例 */
export function buildRouteConfig() {
  const { payTo, network, price } = getPaymentSettings();
  return {
    accepts: [{ scheme: "exact" as const, price, network, payTo }],
    description:
      "Pre-mint check for NFT contracts on Base. Before you mint or buy: who controls the contract (single key, renounced, or a Safe multisig with its approval threshold), whether it is an upgradeable proxy, whether source is verified, supply and max supply, and whether owner functions exist to change metadata, change supply or price, pause, withdraw, or mint extra. Detects SeaDrop and thirdweb drop types. Returns facts and a list of what could not be measured. Heuristics, not an audit, not financial advice.",
    mimeType: "application/json",
    extensions: {
      ...declareDiscoveryExtension({
        input: { address: "0x0000000000000000000000000000000000000000" },
        inputSchema: {
          properties: {
            address: {
              type: "string",
              description: "NFT contract address on Base (0x-prefixed, 40 hex characters).",
              pattern: "^0x[0-9a-fA-F]{40}$",
            },
            tokenId: {
              type: "string",
              description:
                "Optional. Token id as a decimal string. ERC-1155 keeps supply per token, so pass this to read supply for one token.",
              pattern: "^[0-9]+$",
            },
          },
          required: ["address"],
        },
        output: {
          example: {
            address: "0x0000000000000000000000000000000000000000",
            chain: "base",
            basics: { isContract: true, standard: "ERC-721", name: "Example", symbol: "EX" },
            code: { sourceVerified: true, isProxy: false },
            control: {
              owner: "0x0000000000000000000000000000000000000001",
              ownerKind: "contract",
              multisig: { type: "safe", threshold: 2, ownerCount: 3 },
            },
            mint: { tokenId: null, totalSupply: "120", maxSupply: "1000", knownType: "seadrop" },
            capabilities: { canChangeMetadata: true, canPauseTransfers: false, hasOwnerMint: false },
            flags: [{ code: "METADATA_CHANGEABLE", note: "Functions that change metadata/images exist." }],
            notMeasured: [],
          },
        },
      }),
    },
  };
}
