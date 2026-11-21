/**
 * ミント前チェック本体。
 * Base 本番のコントラクトを読み、事実だけを返す（買う／避けるの判断はしない）。
 * 読めなかった項目は null にして notMeasured に理由を書く。
 */
import {
  createPublicClient,
  http,
  getAddress,
  isAddress,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { base } from "viem/chains";
import { readHolders, type HolderConcentration, type OwnersFetcher } from "./holders";
import { readExtras, ROYALTY_SETTERS, type InsiderHoldings, type MetadataInfo, type RolesInfo, type RoyaltyInfo } from "./extras";

// ---------- 型 ----------

export type OwnerKind = "renounced" | "single_key" | "contract" | null;

export interface MintCheckResult {
  address: Address;
  chain: "base";
  checkedAt: string;
  basics: {
    isContract: boolean;
    standard: "ERC-721" | "ERC-1155" | "unknown";
    name: string | null;
    symbol: string | null;
    deployer: Address | null;
    deployedBlock: number | null;
  };
  code: {
    bytecodeSize: number;
    sourceVerified: boolean | null;
    isProxy: boolean;
    proxyKind: "eip1967" | "eip1167_minimal" | null;
    implementation: Address | null;
    proxyAdmin: Address | null;
  };
  control: {
    owner: Address | null;
    ownerKind: OwnerKind;
    /** オーナーが複数人管理（Safe）だった場合の内訳。例: 3人中2人の承認が必要 */
    multisig: { type: "safe"; threshold: number; ownerCount: number } | null;
    /** v0.9: ERC-2981 のロイヤルティ受取人（あれば） */
    royalty: RoyaltyInfo | null;
    /** v0.9: AccessControl の権限と持ち主（あれば） */
    roles: RolesInfo | null;
  };
  mint: {
    /** ERC-1155 では tokenId を指定したときだけ読める */
    tokenId: string | null;
    totalSupply: string | null;
    maxSupply: string | null;
    /** 標準の型と一致したときだけ埋まる */
    knownType: "seadrop" | "thirdweb" | null;
    knownTypeDetail: string | null;
    /** v0.9: オーナー・作成者が持っている枚数（事前ミントやチーム分） */
    insiderHoldings: InsiderHoldings | null;
    /** v0.13: 保有者数と上位の保有割合（Alchemy NFT API が使えるときだけ） */
    holderConcentration: HolderConcentration | null;
  };
  /** バイトコードから見つかった「オーナーが使えそうな操作」。関数名の一致による推定 */
  capabilities: {
    canChangeMetadata: boolean | null;
    canChangeSupplyOrPrice: boolean | null;
    canPauseTransfers: boolean | null;
    hasWithdraw: boolean | null;
    hasOwnerMint: boolean | null;
    /** v0.9 */
    canChangeRoyalty: boolean | null;
    matchedFunctions: string[];
    /** v0.9: 画像（メタデータ）の置き場所と凍結 */
    metadata: MetadataInfo | null;
  };
  flags: { code: string; note: string }[];
  notMeasured: { item: string; reason: string }[];
  disclaimer: string;
}

// ---------- 定数 ----------

const ERC165_ABI = [
  {
    type: "function",
    name: "supportsInterface",
    stateMutability: "view",
    inputs: [{ name: "id", type: "bytes4" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const READ_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "MAX_SUPPLY", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "contractType", stateMutability: "pure", inputs: [], outputs: [{ type: "bytes32" }] },
] as const;

/** ERC-1155 はトークン番号ごとに発行数を持つ */
const PER_TOKEN_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxSupply", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

/** Safe（複数人管理ウォレット）の読み取り */
const SAFE_ABI = [
  { type: "function", name: "getThreshold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
] as const;

const IFACE_ERC721 = "0x80ac58cd" as Hex;
const IFACE_ERC1155 = "0xd9b67a26" as Hex;

// EIP-1967 の保存場所
const SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const SLOT_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as Hex;

/** 探す関数。group ごとに「何ができるか」をまとめる */
const WATCHED: { group: keyof Groups; sig: string }[] = [
  // 画像・メタデータの差し替え
  { group: "metadata", sig: "function setBaseURI(string)" },
  { group: "metadata", sig: "function setTokenURI(uint256,string)" },
  { group: "metadata", sig: "function setContractURI(string)" },
  { group: "metadata", sig: "function setURI(string)" },
  { group: "metadata", sig: "function reveal(string)" },
  // 発行数・価格の変更
  { group: "supplyOrPrice", sig: "function setMaxSupply(uint256)" },
  { group: "supplyOrPrice", sig: "function setPrice(uint256)" },
  { group: "supplyOrPrice", sig: "function setMintPrice(uint256)" },
  { group: "supplyOrPrice", sig: "function setCost(uint256)" },
  { group: "supplyOrPrice", sig: "function setMaxPerWallet(uint256)" },
  // 転送の停止
  { group: "pause", sig: "function pause()" },
  { group: "pause", sig: "function unpause()" },
  { group: "pause", sig: "function setPaused(bool)" },
  // 売上の引き出し
  { group: "withdraw", sig: "function withdraw()" },
  { group: "withdraw", sig: "function withdraw(address)" },
  { group: "withdraw", sig: "function withdrawAll()" },
  { group: "withdraw", sig: "function release(address)" },
  // オーナーによる追加発行
  { group: "ownerMint", sig: "function ownerMint(address,uint256)" },
  { group: "ownerMint", sig: "function adminMint(address,uint256)" },
  { group: "ownerMint", sig: "function mintTo(address,uint256)" },
  { group: "ownerMint", sig: "function airdrop(address[],uint256[])" },
  { group: "ownerMint", sig: "function reserve(uint256)" },
];

interface Groups {
  metadata: string[];
  supplyOrPrice: string[];
  pause: string[];
  withdraw: string[];
  ownerMint: string[];
}

// SeaDrop 型の目印になる関数
const SEADROP_MARKERS = [
  "function updateAllowedSeaDrop(address[])",
  "function getMintStats(address)",
];

const DISCLAIMER =
  "On-chain facts and bytecode heuristics only. Not an audit, not financial advice, no guarantee of accuracy.";

// ---------- 小道具 ----------

export function makeClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl || undefined, { timeout: 10_000, retryCount: 1 }),
  }) as PublicClient;
}

async function tryRead<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

function slotToAddress(value: Hex | undefined): Address | null {
  if (!value || value.length < 66) return null;
  const addr = ("0x" + value.slice(26)) as Address;
  if (addr.toLowerCase() === zeroAddress) return null;
  return getAddress(addr);
}

/** EIP-1167（最小プロキシ）なら転送先を返す */
export function minimalProxyTarget(code: Hex): Address | null {
  const c = code.toLowerCase();
  const prefix = "0x363d3d373d3d3d363d73";
  const suffix = "5af43d82803e903d91602b57fd5bf3";
  if (c.startsWith(prefix) && c.endsWith(suffix) && c.length === 2 + 45 * 2) {
    return getAddress(("0x" + c.slice(prefix.length, prefix.length + 40)) as Address);
  }
  return null;
}

/** バイトコード中に関数セレクタ（PUSH4 + 4バイト）があるか */
export function hasSelector(code: Hex, signature: string): boolean {
  const selector = toFunctionSelector(signature).slice(2).toLowerCase();
  return code.toLowerCase().includes("63" + selector);
}

function bytes32ToText(value: Hex): string {
  const hex = value.slice(2).replace(/(00)+$/, "");
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const n = parseInt(hex.slice(i, i + 2), 16);
    if (n < 32 || n > 126) return "";
    out += String.fromCharCode(n);
  }
  return out;
}

/** Sourcify でソース公開状況と作成者を調べる（無料・登録不要） */
async function lookupSourcify(address: Address): Promise<{
  verified: boolean | null;
  deployer: Address | null;
  deployedBlock: number | null;
}> {
  const unknown = { verified: null, deployer: null, deployedBlock: null };
  try {
    const res = await fetch(
      `https://sourcify.dev/server/v2/contract/8453/${address}?fields=deployment`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (res.status === 404) return { verified: false, deployer: null, deployedBlock: null };
    if (!res.ok) return unknown;
    const body = (await res.json()) as {
      match?: string | null;
      deployment?: { deployer?: string | null; blockNumber?: string | number | null };
    };
    const deployer =
      body.deployment?.deployer && isAddress(body.deployment.deployer)
        ? getAddress(body.deployment.deployer)
        : null;
    const block = body.deployment?.blockNumber;
    return {
      verified: Boolean(body.match),
      deployer,
      deployedBlock: block != null && !Number.isNaN(Number(block)) ? Number(block) : null,
    };
  } catch {
    return unknown;
  }
}

// ---------- 本体 ----------

export async function runMintCheck(
  rawAddress: string,
  client: PublicClient,
  opts: { sourcify?: boolean; tokenId?: bigint; holders?: OwnersFetcher | null } = {},
): Promise<MintCheckResult> {
  const address = getAddress(rawAddress);
  const flags: MintCheckResult["flags"] = [];
  const notMeasured: MintCheckResult["notMeasured"] = [];

  const code = (await client.getCode({ address })) ?? "0x";
  const isContract = code !== "0x";

  const result: MintCheckResult = {
    address,
    chain: "base",
    checkedAt: new Date().toISOString(),
    basics: {
      isContract,
      standard: "unknown",
      name: null,
      symbol: null,
      deployer: null,
      deployedBlock: null,
    },
    code: {
      bytecodeSize: isContract ? (code.length - 2) / 2 : 0,
      sourceVerified: null,
      isProxy: false,
      proxyKind: null,
      implementation: null,
      proxyAdmin: null,
    },
    control: { owner: null, ownerKind: null, multisig: null, royalty: null, roles: null },
    mint: {
      tokenId: opts.tokenId != null ? opts.tokenId.toString() : null,
      totalSupply: null,
      maxSupply: null,
      knownType: null,
      knownTypeDetail: null,
      insiderHoldings: null,
      holderConcentration: null,
    },
    capabilities: {
      canChangeMetadata: null,
      canChangeSupplyOrPrice: null,
      canPauseTransfers: null,
      hasWithdraw: null,
      hasOwnerMint: null,
      canChangeRoyalty: null,
      matchedFunctions: [],
      metadata: null,
    },
    flags,
    notMeasured,
    disclaimer: DISCLAIMER,
  };

  if (!isContract) {
    flags.push({ code: "NOT_A_CONTRACT", note: "This address has no code on Base." });
    return result;
  }

  const read = <N extends (typeof READ_ABI)[number]["name"]>(functionName: N) =>
    tryRead(() => client.readContract({ address, abi: READ_ABI, functionName } as never));

  // 並行して読む
  const [
    is721,
    is1155,
    name,
    symbol,
    owner,
    totalSupply,
    maxSupplyA,
    maxSupplyB,
    contractType,
    implSlot,
    adminSlot,
    sourcify,
  ] = await Promise.all([
    tryRead(() =>
      client.readContract({ address, abi: ERC165_ABI, functionName: "supportsInterface", args: [IFACE_ERC721] }),
    ),
    tryRead(() =>
      client.readContract({ address, abi: ERC165_ABI, functionName: "supportsInterface", args: [IFACE_ERC1155] }),
    ),
    read("name") as Promise<string | null>,
    read("symbol") as Promise<string | null>,
    read("owner") as Promise<Address | null>,
    read("totalSupply") as Promise<bigint | null>,
    read("maxSupply") as Promise<bigint | null>,
    read("MAX_SUPPLY") as Promise<bigint | null>,
    read("contractType") as Promise<Hex | null>,
    tryRead(() => client.getStorageAt({ address, slot: SLOT_IMPL })),
    tryRead(() => client.getStorageAt({ address, slot: SLOT_ADMIN })),
    opts.sourcify === false
      ? Promise.resolve({ verified: null, deployer: null, deployedBlock: null })
      : lookupSourcify(address),
  ]);

  // 1. 基本
  result.basics.standard = is721 ? "ERC-721" : is1155 ? "ERC-1155" : "unknown";
  result.basics.name = name;
  result.basics.symbol = symbol;
  result.basics.deployer = sourcify.deployer;
  result.basics.deployedBlock = sourcify.deployedBlock;
  if (result.basics.standard === "unknown") {
    flags.push({
      code: "NOT_NFT_STANDARD",
      note: "Does not report ERC-721 or ERC-1155 via ERC-165.",
    });
  }
  if (name == null) notMeasured.push({ item: "name", reason: "No readable name()." });
  if (symbol == null) notMeasured.push({ item: "symbol", reason: "No readable symbol()." });
  if (!sourcify.deployer) {
    notMeasured.push({ item: "deployer", reason: "Not available from Sourcify for this contract." });
  }

  // 2. コード
  result.code.sourceVerified = sourcify.verified;
  if (sourcify.verified === null) {
    notMeasured.push({ item: "sourceVerified", reason: "Sourcify lookup failed or timed out." });
  } else if (sourcify.verified === false) {
    flags.push({ code: "SOURCE_NOT_VERIFIED", note: "No verified source on Sourcify." });
  }

  let logicCode: Hex = code;
  const minimalTarget = minimalProxyTarget(code);
  const impl1967 = slotToAddress(implSlot ?? undefined);
  if (minimalTarget) {
    result.code.isProxy = true;
    result.code.proxyKind = "eip1167_minimal";
    result.code.implementation = minimalTarget;
  } else if (impl1967) {
    result.code.isProxy = true;
    result.code.proxyKind = "eip1967";
    result.code.implementation = impl1967;
    result.code.proxyAdmin = slotToAddress(adminSlot ?? undefined);
    flags.push({
      code: "UPGRADEABLE_PROXY",
      note: "Logic can be replaced by whoever controls the upgrade.",
    });
  }
  if (result.code.implementation) {
    const implCode = await tryRead(() => client.getCode({ address: result.code.implementation! }));
    if (implCode && implCode !== "0x") {
      logicCode = implCode;
    } else {
      notMeasured.push({ item: "capabilities", reason: "Implementation code could not be read." });
    }
  }

  // 3. 支配者
  if (owner) {
    result.control.owner = getAddress(owner);
    if (owner.toLowerCase() === zeroAddress) {
      result.control.ownerKind = "renounced";
    } else {
      const ownerCode = await tryRead(() => client.getCode({ address: owner }));
      if (ownerCode === null) {
        notMeasured.push({ item: "ownerKind", reason: "Owner code could not be read." });
      } else if (ownerCode && ownerCode !== "0x") {
        result.control.ownerKind = "contract";
        const [threshold, safeOwners] = await Promise.all([
          tryRead(() => client.readContract({ address: owner, abi: SAFE_ABI, functionName: "getThreshold" })),
          tryRead(() => client.readContract({ address: owner, abi: SAFE_ABI, functionName: "getOwners" })),
        ]);
        if (threshold != null && safeOwners != null && safeOwners.length > 0) {
          result.control.multisig = {
            type: "safe",
            threshold: Number(threshold),
            ownerCount: safeOwners.length,
          };
          if (Number(threshold) <= 1) {
            flags.push({
              code: "MULTISIG_SINGLE_APPROVAL",
              note: "Owner is a Safe, but one approval is enough to act.",
            });
          }
        } else {
          notMeasured.push({
            item: "control.multisig",
            reason: "Owner is a contract but not a readable Safe; its rules were not analysed.",
          });
        }
      } else {
        result.control.ownerKind = "single_key";
        flags.push({ code: "OWNER_SINGLE_KEY", note: "Owner is a single externally owned key." });
      }
    }
  } else {
    notMeasured.push({ item: "owner", reason: "No readable owner() function." });
  }

  // 4. 発行数
  const is1155Token = result.basics.standard === "ERC-1155";
  let supply: bigint | null = totalSupply;
  let maxSupply: bigint | null = maxSupplyA ?? maxSupplyB;
  if (opts.tokenId != null) {
    // トークン番号が指定されたら、番号ごとの値を優先して読む
    const id = opts.tokenId;
    const [perTokenSupply, perTokenMax] = await Promise.all([
      tryRead(() => client.readContract({ address, abi: PER_TOKEN_ABI, functionName: "totalSupply", args: [id] })),
      tryRead(() => client.readContract({ address, abi: PER_TOKEN_ABI, functionName: "maxSupply", args: [id] })),
    ]);
    if (is1155Token) {
      supply = perTokenSupply;
      maxSupply = perTokenMax;
    } else {
      supply = supply ?? perTokenSupply;
      maxSupply = maxSupply ?? perTokenMax;
    }
  }
  result.mint.totalSupply = supply != null ? supply.toString() : null;
  result.mint.maxSupply = maxSupply != null ? maxSupply.toString() : null;
  const needsTokenId = is1155Token && opts.tokenId == null;
  if (supply == null) {
    notMeasured.push({
      item: "totalSupply",
      reason: needsTokenId
        ? "ERC-1155 keeps supply per token. Pass tokenId to read it."
        : opts.tokenId != null
          ? "No readable totalSupply(tokenId)."
          : "No readable totalSupply().",
    });
  }
  if (maxSupply == null) {
    notMeasured.push({
      item: "maxSupply",
      reason: needsTokenId
        ? "ERC-1155 keeps supply per token. Pass tokenId to read it."
        : "No readable max supply function.",
    });
  }

  // 7. 既知の型
  const thirdwebType = contractType ? bytes32ToText(contractType) : "";
  if (SEADROP_MARKERS.every(sig => hasSelector(logicCode, sig))) {
    result.mint.knownType = "seadrop";
    result.mint.knownTypeDetail = "SeaDrop-compatible (OpenSea drop standard)";
  } else if (thirdwebType) {
    result.mint.knownType = "thirdweb";
    result.mint.knownTypeDetail = `thirdweb ${thirdwebType}`;
  }

  // 5・6. オーナーが使えそうな操作（関数名の一致による推定）
  const groups: Groups = { metadata: [], supplyOrPrice: [], pause: [], withdraw: [], ownerMint: [] };
  for (const w of WATCHED) {
    if (hasSelector(logicCode, w.sig)) groups[w.group].push(w.sig.replace("function ", ""));
  }
  result.capabilities = {
    canChangeMetadata: groups.metadata.length > 0,
    canChangeSupplyOrPrice: groups.supplyOrPrice.length > 0,
    canPauseTransfers: groups.pause.length > 0,
    hasWithdraw: groups.withdraw.length > 0,
    hasOwnerMint: groups.ownerMint.length > 0,
    canChangeRoyalty: null,
    matchedFunctions: Object.values(groups).flat(),
    metadata: null,
  };
  if (groups.metadata.length) {
    flags.push({ code: "METADATA_CHANGEABLE", note: "Functions that change metadata/images exist." });
  }
  if (groups.supplyOrPrice.length) {
    flags.push({ code: "SUPPLY_OR_PRICE_CHANGEABLE", note: "Functions that change supply or price exist." });
  }
  if (groups.pause.length) {
    flags.push({ code: "PAUSABLE", note: "Functions that pause the contract exist." });
  }
  if (groups.ownerMint.length) {
    flags.push({ code: "OWNER_MINT", note: "Functions for privileged extra minting exist." });
  }
  // 8. v0.9 の追加点検（メタデータ・ロイヤルティ・権限・保有枚数）
  const extras = await readExtras({
    client,
    address,
    standard: result.basics.standard,
    tokenId: opts.tokenId,
    owner: result.control.owner,
    ownerRenounced: result.control.ownerKind === "renounced",
    ownerKind:
      result.control.ownerKind === "single_key" || result.control.ownerKind === "contract" ? result.control.ownerKind : null,
    deployer: result.basics.deployer,
    totalSupply: result.mint.totalSupply,
    hasFunction: sig => hasSelector(logicCode, sig),
    flags,
    notMeasured,
  });
  result.capabilities.metadata = extras.metadata;
  result.capabilities.canChangeRoyalty = extras.canChangeRoyalty;
  if (extras.canChangeRoyalty) {
    result.capabilities.matchedFunctions.push(
      ...ROYALTY_SETTERS.filter(sig => hasSelector(logicCode, sig)).map(sig => sig.replace("function ", "")),
    );
  }
  result.control.royalty = extras.royalty;
  result.control.roles = extras.roles;
  result.mint.insiderHoldings = extras.insiderHoldings;

  // 9. v0.13 保有者の偏り
  result.mint.holderConcentration = await readHolders({
    fetcher: opts.holders ?? null,
    address,
    standard: result.basics.standard,
    tokenId: opts.tokenId,
    owner: result.control.ownerKind === "renounced" ? null : result.control.owner,
    deployer: result.basics.deployer,
    flags,
    notMeasured,
  });

  notMeasured.push({
    item: "capabilities.completeness",
    reason:
      "Detected by matching common function names in bytecode. Custom-named functions are not detected, so 'false' means 'not found', not 'impossible'.",
  });

  return result;
}

export function isValidAddress(value: string | null): value is string {
  return !!value && isAddress(value);
}

/** tokenId の文字列（10進）を検証して bigint にする。未指定は undefined、不正は null */
export function parseTokenId(value: string | null | undefined): bigint | undefined | null {
  if (value == null || value === "") return undefined;
  if (!/^[0-9]{1,78}$/.test(value)) return null;
  return BigInt(value);
}
