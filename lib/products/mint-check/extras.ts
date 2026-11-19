/**
 * v0.9 で足した点検（2026-11-20、Surf が挙げた 2026 年の Base の手口から）:
 *   1. メタデータ（画像）の置き場所と凍結       → capabilities.metadata
 *   2. ロイヤルティの受取人と変更できるか        → control.royalty / capabilities.canChangeRoyalty
 *   3. AccessControl の権限（MINTER_ROLE など）  → control.roles
 *   4. オーナー・作成者が持っている枚数          → mint.insiderHoldings
 * どれも返す中身に足すだけで、説明文・マニフェスト・Bazaar の例は変えない（OpenSea のハッシュを保つ）。
 */
import { keccak256, toBytes, zeroHash, getAddress, type Address, type Hex, type PublicClient } from "viem";

export type HolderKind = "single_key" | "contract";

export interface MetadataInfo {
  sampleTokenId: string | null;
  uri: string | null;
  /** onchain_data: data: URI / ipfs・arweave: 中身で決まる住所 / web: http(s) のサーバー */
  location: "onchain_data" | "ipfs" | "arweave" | "web" | "other" | null;
  frozen: boolean | null;
}

export interface RoyaltyInfo {
  receiver: Address;
  receiverKind: HolderKind | null;
  bps: number;
}

export interface RolesInfo {
  accessControl: boolean;
  enumerable: boolean;
  /** 列挙できたときだけ埋まる。最大5人まで */
  holders: { role: string; count: number; members: { address: Address; kind: HolderKind | null }[] }[];
}

export interface InsiderHoldings {
  owner: string | null;
  deployer: string | null;
  /** (オーナー＋作成者の枚数) ÷ 発行数。読めないときは null */
  shareOfSupply: number | null;
}

type Flag = { code: string; note: string };
type NotMeasured = { item: string; reason: string };

const IFACE_ERC2981 = "0x2a55205a" as Hex;
const IFACE_ACCESS_CONTROL = "0x7965db0b" as Hex;
const IFACE_ACCESS_CONTROL_ENUMERABLE = "0x5a05180f" as Hex;

export const ROLES: { name: string; id: Hex }[] = [
  { name: "DEFAULT_ADMIN_ROLE", id: zeroHash },
  { name: "MINTER_ROLE", id: keccak256(toBytes("MINTER_ROLE")) },
  { name: "METADATA_ROLE", id: keccak256(toBytes("METADATA_ROLE")) },
  { name: "PAUSER_ROLE", id: keccak256(toBytes("PAUSER_ROLE")) },
];

/** ロイヤルティを変える関数（バイトコードの関数名一致で探す） */
export const ROYALTY_SETTERS = [
  "function setDefaultRoyalty(address,uint96)",
  "function setTokenRoyalty(uint256,address,uint96)",
  "function setRoyaltyInfo(address,uint96)",
  "function setRoyaltyInfoForToken(uint256,address,uint256)",
  "function setDefaultRoyaltyInfo(address,uint256)",
  "function setRoyalties(address,uint96)",
];

/** 凍結状態を返す読み取り関数（名前はコントラクトごとに違う） */
const FREEZE_GETTERS = ["metadataFrozen", "isMetadataFrozen", "metadataLocked", "baseURILocked", "uriFrozen", "frozen"] as const;

const ABI = [
  { type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ type: "bytes4" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] },
  { type: "function", name: "uri", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "royaltyInfo",
    stateMutability: "view",
    inputs: [{ type: "uint256" }, { type: "uint256" }],
    outputs: [{ type: "address" }, { type: "uint256" }],
  },
  { type: "function", name: "getRoleMemberCount", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getRoleMember", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  ...FREEZE_GETTERS.map(name => ({ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }) as const),
] as const;

const BALANCE_1155_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

async function tryRead<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

export function classifyUri(uri: string): MetadataInfo["location"] {
  const u = uri.trim().toLowerCase();
  if (u.startsWith("data:")) return "onchain_data";
  if (u.startsWith("ipfs://") || /^https?:\/\/[^/]+\/ipfs\/[a-z0-9]/.test(u) || /^https?:\/\/[a-z0-9]{46,}\.ipfs\./.test(u)) return "ipfs";
  if (u.startsWith("ar://") || /^https?:\/\/(www\.)?arweave\.net\//.test(u)) return "arweave";
  if (u.startsWith("http://") || u.startsWith("https://")) return "web";
  return "other";
}

/** 公開RPCは一度に多く送ると断ることがあるので、大事な読み取りは少し待って1回だけやり直す */
async function readTwice<T>(fn: () => Promise<T>): Promise<T | null> {
  const first = await tryRead(fn);
  if (first !== null) return first;
  await new Promise(r => setTimeout(r, 400));
  return tryRead(fn);
}

async function kindOf(client: PublicClient, a: Address): Promise<HolderKind | null> {
  const code = await readTwice(() => client.getCode({ address: a }));
  if (code === null) return null;
  // EIP-7702 で委任された普通のアドレスも、鍵1本で動かせるので single_key
  if (!code || code === "0x" || code.toLowerCase().startsWith("0xef0100")) return "single_key";
  return "contract";
}

export async function readExtras(args: {
  client: PublicClient;
  address: Address;
  standard: "ERC-721" | "ERC-1155" | "unknown";
  tokenId?: bigint;
  owner: Address | null;
  ownerRenounced: boolean;
  /** オーナーの種類（すでに調べ済みなら使い回す） */
  ownerKind?: HolderKind | null;
  deployer: Address | null;
  totalSupply: string | null;
  hasFunction: (signature: string) => boolean;
  flags: Flag[];
  notMeasured: NotMeasured[];
}): Promise<{
  metadata: MetadataInfo;
  canChangeRoyalty: boolean;
  royalty: RoyaltyInfo | null;
  roles: RolesInfo | null;
  insiderHoldings: InsiderHoldings;
}> {
  const { client, address, standard, tokenId, flags, notMeasured } = args;
  const read = (functionName: string, a: unknown[] = []) =>
    tryRead(() => client.readContract({ address, abi: ABI, functionName, args: a } as never)) as Promise<unknown>;
  const supports = (id: Hex) => read("supportsInterface", [id]) as Promise<boolean | null>;

  // --- 1. メタデータの置き場所（読み取りはまとめて並行に） ---
  const candidates = tokenId != null ? [tokenId] : [1n, 0n];
  const uriFn = standard === "ERC-1155" ? "uri" : "tokenURI";
  // 凍結の読み取り関数は、コードに実在するものだけ呼ぶ（無駄な問い合わせで公開RPCに断られないため）
  const freezeGetters = FREEZE_GETTERS.filter(g => args.hasFunction(`function ${g}()`));
  const usesAccessControl = args.hasFunction("function hasRole(bytes32,address)");
  const [is2981, isAC, isEnum] = await Promise.all([
    supports(IFACE_ERC2981),
    usesAccessControl ? supports(IFACE_ACCESS_CONTROL) : Promise.resolve(null),
    usesAccessControl ? supports(IFACE_ACCESS_CONTROL_ENUMERABLE) : Promise.resolve(null),
  ]);
  let sampleTokenId: bigint | null = null;
  let uri: string | null = null;
  for (const id of candidates) {
    const v = (await read(uriFn, [id])) as string | null;
    if (typeof v === "string" && v.length > 0) {
      sampleTokenId = id;
      uri = v;
      break;
    }
  }
  let frozen: boolean | null = null;
  for (const g of freezeGetters) {
    const v = (await read(g)) as boolean | null;
    if (typeof v === "boolean") {
      frozen = v;
      break;
    }
  }
  const location = uri ? classifyUri(uri) : null;
  const metadata: MetadataInfo = {
    sampleTokenId: sampleTokenId != null ? sampleTokenId.toString() : null,
    uri: uri ? (uri.startsWith("data:") ? `${uri.slice(0, 40)}…` : uri.slice(0, 200)) : null,
    location,
    frozen,
  };
  if (!uri) {
    notMeasured.push({
      item: "capabilities.metadata.location",
      reason: standard === "ERC-1155" && tokenId == null ? "No readable uri(1) or uri(0). Pass tokenId." : "No readable tokenURI for the sampled token ids (often: nothing minted yet).",
    });
  }
  if (frozen === null) notMeasured.push({ item: "capabilities.metadata.frozen", reason: "No common freeze getter (metadataFrozen() and similar) found." });
  if (location === "web" && frozen !== true) {
    flags.push({
      code: "METADATA_ON_WEB_SERVER",
      note: "Metadata is served from a web server, so images can change off-chain without any transaction.",
    });
  }

  // --- 2. ロイヤルティ ---
  const canChangeRoyalty = ROYALTY_SETTERS.some(s => args.hasFunction(s));
  let royalty: RoyaltyInfo | null = null;
  if (is2981) {
    const r = (await read("royaltyInfo", [sampleTokenId ?? 1n, 10_000n])) as readonly [Address, bigint] | null;
    if (r && r[0] && !/^0x0{40}$/i.test(r[0])) {
      const sameAsOwner = args.owner && r[0].toLowerCase() === args.owner.toLowerCase() && args.ownerKind;
      royalty = {
        receiver: getAddress(r[0]),
        receiverKind: sameAsOwner ? args.ownerKind! : await kindOf(client, r[0]),
        bps: Number(r[1]),
      };
    } else if (!r) {
      notMeasured.push({ item: "control.royalty", reason: "Reports ERC-2981 but royaltyInfo() could not be read." });
    }
  }
  if (canChangeRoyalty) {
    flags.push({ code: "ROYALTY_CHANGEABLE", note: "Functions that change the royalty receiver or rate exist." });
  }

  // --- 3. AccessControl の権限 ---
  let roles: RolesInfo | null = null;
  if (isAC || isEnum) {
    roles = { accessControl: true, enumerable: !!isEnum, holders: [] };
    if (isEnum) {
      for (const role of ROLES) {
        const count = (await read("getRoleMemberCount", [role.id])) as bigint | null;
        if (count == null || count === 0n) continue;
        const members: { address: Address; kind: HolderKind | null }[] = [];
        for (let i = 0n; i < count && i < 5n; i++) {
          const m = (await read("getRoleMember", [role.id, i])) as Address | null;
          if (m) members.push({ address: getAddress(m), kind: await kindOf(client, m) });
        }
        roles.holders.push({ role: role.name, count: Number(count), members });
      }
      const minter = roles.holders.find(h => h.role === "MINTER_ROLE" || h.role === "DEFAULT_ADMIN_ROLE");
      if (minter?.members.some(m => m.kind === "single_key")) {
        flags.push({ code: "ROLE_HELD_BY_SINGLE_KEY", note: `${minter.role} is held by a single key.` });
      }
    } else {
      notMeasured.push({ item: "control.roles.holders", reason: "Uses AccessControl but its role holders cannot be listed on-chain." });
    }
    if (args.ownerRenounced && (!isEnum || roles.holders.length > 0)) {
      flags.push({
        code: "ROLES_REMAIN_AFTER_RENOUNCE",
        note: "owner() is renounced, but AccessControl roles can still control the contract.",
      });
    }
  }

  // --- 4. オーナー・作成者の保有枚数 ---
  const holdingOf = async (a: Address | null): Promise<bigint | null> => {
    if (!a || /^0x0{40}$/i.test(a)) return null;
    if (standard === "ERC-1155") {
      if (tokenId == null) return null;
      return readTwice(() => client.readContract({ address, abi: BALANCE_1155_ABI, functionName: "balanceOf", args: [a, tokenId] }));
    }
    return readTwice(() => client.readContract({ address, abi: ABI, functionName: "balanceOf", args: [a] } as never)) as Promise<bigint | null>;
  };
  const ownerBal = await holdingOf(args.ownerRenounced ? null : args.owner);
  const deployerBal =
    args.deployer && args.deployer.toLowerCase() !== args.owner?.toLowerCase() ? await holdingOf(args.deployer) : null;
  const supply = args.totalSupply != null ? BigInt(args.totalSupply) : null;
  const insiders = (ownerBal ?? 0n) + (deployerBal ?? 0n);
  const share = supply && supply > 0n && (ownerBal != null || deployerBal != null) ? Number((insiders * 10_000n) / supply) / 10_000 : null;
  const insiderHoldings: InsiderHoldings = {
    owner: ownerBal != null ? ownerBal.toString() : null,
    deployer: deployerBal != null ? deployerBal.toString() : null,
    shareOfSupply: share,
  };
  if (ownerBal == null && deployerBal == null) {
    notMeasured.push({
      item: "mint.insiderHoldings",
      reason: standard === "ERC-1155" && tokenId == null ? "ERC-1155 balances are per token. Pass tokenId." : "Owner/deployer balances could not be read.",
    });
  }
  if (share != null && share >= 0.2) {
    flags.push({
      code: "INSIDERS_HOLD_LARGE_SHARE",
      note: `Owner and deployer hold ${(share * 100).toFixed(1)}% of current supply (pre-mint or team allocation).`,
    });
  }

  return { metadata, canChangeRoyalty, royalty, roles, insiderHoldings };
}
