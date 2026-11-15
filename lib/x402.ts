/**
 * 料金所の設定。
 * 環境変数だけで「練習用（Base Sepolia）」と「本番（Base）」を切り替えられるようにしてある。
 */
import { x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";

type Network = `${string}:${string}`;

export function getPaymentSettings() {
  const payTo = process.env.PAY_TO;
  if (!payTo || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw new Error("PAY_TO が未設定です。売上を受け取るアドレスを環境変数に入れてください。");
  }
  return {
    payTo,
    network: (process.env.X402_NETWORK || "eip155:84532") as Network,
    facilitatorUrl: process.env.FACILITATOR_URL || "https://x402.org/facilitator",
    price: process.env.PRICE || "$0.02",
  };
}

export function buildResourceServer() {
  const { network, facilitatorUrl } = getPaymentSettings();
  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(network, new ExactEvmScheme());
  // Bazaar（カタログ）に載るための拡張
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
