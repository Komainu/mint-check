/**
 * 1号商品: Mint Check（Base の NFT コントラクトのミント前チェック）
 *
 * 2026-11-16 に Base 本番で公開、Bazaar 掲載、OpenSea にツール番号933で登録済み。
 * ここの文字列（説明・タグ・入出力）はオンチェーンのハッシュに含まれるので、変えるときは
 * manifest.version を上げ、OpenSea の記録も更新すること。
 */
import type { Product } from "@/lib/shop/types";
import { isValidAddress, makeClient, parseTokenId, runMintCheck } from "./checks";

export const mintCheck: Product = {
  slug: "mint-check",
  serviceName: "Mint Check",
  description:
    "Pre-mint check for NFT contracts on Base. Returns on-chain facts: who controls the contract (single key, renounced, or Safe multisig with threshold), upgradeable proxy, verified source, supply and max supply, and owner functions to change metadata, supply or price, pause, withdraw, or mint extra. Detects SeaDrop and thirdweb drops. Lists what could not be measured. Not an audit or financial advice.",
  tags: ["nft", "pre-mint-check", "contract-risk", "base", "rug-check"],
  // 1号商品は以前から環境変数 PRICE で価格を決めている（変えるとハッシュが変わる）
  price: () => process.env.PRICE || "$0.02",

  bazaar: {
    inputExample: { address: "0x0000000000000000000000000000000000000000" },
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
    outputExample: {
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

  manifest: {
    version: "0.5.0",
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
  },

  async run(input) {
    if (!isValidAddress(input.address)) {
      return {
        status: 400,
        body: { error: "address is required: a 0x-prefixed 40-hex contract address on Base." },
      };
    }
    const tokenId = parseTokenId(input.tokenId);
    if (tokenId === null) {
      return { status: 400, body: { error: "tokenId must be a non-negative decimal integer." } };
    }
    try {
      const result = await runMintCheck(input.address, makeClient(process.env.BASE_RPC_URL), { tokenId });
      return { status: 200, body: result };
    } catch {
      return { status: 502, body: { error: "Upstream RPC failed. You were not charged." } };
    }
  },
};
