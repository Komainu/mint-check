/**
 * Mint Check v0.13: 保有者の偏り（2026-11-22 追加）
 *
 * Alchemy の NFT API（getOwnersForContract、withTokenBalances=true）で保有者と枚数の一覧を取り、
 * 保有者数・上位1人と上位10人が持つ割合を出す。
 * - 鍵は BASE_RPC_URL（https://base-mainnet.g.alchemy.com/v2/<key>）から作る。Alchemy 以外の RPC なら測らない。
 * - 1ページ最大5万人。MAX_PAGES を超える大きなコレクションは「一部だけ」になるので割合は出さない。
 * - 失敗しても点検全体は止めない（notMeasured に書く）。
 * - 返り値に鍵や URL は含めない。
 */
import { getAddress, type Address } from "viem";

export type HolderOwner = { ownerAddress: string; tokenBalances: { tokenId: string; balance: number | string }[] };
export type OwnersPage = { owners: HolderOwner[]; pageKey?: string | null };
/** ページを1枚取る関数（テストでは偽物に差し替える） */
export type OwnersFetcher = (contract: Address, pageKey?: string) => Promise<OwnersPage>;

export interface TopHolder {
  address: Address;
  count: string;
  share: number;
  /** オーナー・作成者なら印を付ける */
  role: "owner" | "deployer" | null;
}

export interface HolderConcentration {
  source: "alchemy_nft_api";
  /** ERC-1155 で tokenId を指定したときはその番号だけを数える */
  tokenId: string | null;
  holderCount: number;
  heldTotal: string;
  top1Share: number;
  top10Share: number;
  top: TopHolder[];
  note: string;
}

const MAX_PAGES = 2;
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

/** BASE_RPC_URL が Alchemy のときだけ NFT API の取り方を作る */
export function alchemyOwnersFetcher(rpcUrl: string | undefined, timeoutMs = 8000): OwnersFetcher | null {
  if (!rpcUrl) return null;
  let u: URL;
  try {
    u = new URL(rpcUrl);
  } catch {
    return null;
  }
  const m = u.pathname.match(/^\/v2\/([A-Za-z0-9_-]+)\/?$/);
  if (u.protocol !== "https:" || !u.hostname.endsWith(".g.alchemy.com") || !m) return null;
  const base = `https://${u.hostname}/nft/v3/${m[1]}/getOwnersForContract`;
  return async (contract, pageKey) => {
    const q = new URLSearchParams({ contractAddress: contract, withTokenBalances: "true" });
    if (pageKey) q.set("pageKey", pageKey);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}?${q}`, { headers: { accept: "application/json" }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`alchemy nft api ${res.status}`);
      return (await res.json()) as OwnersPage;
    } finally {
      clearTimeout(timer);
    }
  };
}

function toBigInt(v: number | string): bigint | null {
  try {
    if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? BigInt(Math.floor(v)) : null;
    return BigInt(v);
  } catch {
    return null;
  }
}

const ratio = (a: bigint, b: bigint) => (b > 0n ? Number((a * 10_000n) / b) / 10_000 : 0);

export async function readHolders(args: {
  fetcher: OwnersFetcher | null;
  address: Address;
  standard: "ERC-721" | "ERC-1155" | "unknown";
  tokenId?: bigint;
  owner: Address | null;
  deployer: Address | null;
  flags: { code: string; note: string }[];
  notMeasured: { item: string; reason: string }[];
}): Promise<HolderConcentration | null> {
  const { fetcher, address, standard, tokenId, flags, notMeasured } = args;
  const item = "mint.holderConcentration";
  if (!fetcher) {
    notMeasured.push({ item, reason: "Holder list is not available in this deployment (needs an NFT indexer)." });
    return null;
  }
  if (standard === "unknown") {
    notMeasured.push({ item, reason: "Not an ERC-721 or ERC-1155 contract." });
    return null;
  }

  const counts = new Map<string, bigint>();
  let pageKey: string | undefined;
  let pages = 0;
  try {
    do {
      const page = await fetcher(address, pageKey);
      if (!page || !Array.isArray(page.owners)) throw new Error("bad response");
      for (const o of page.owners) {
        const who = String(o.ownerAddress ?? "").toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(who) || BURN.has(who)) continue;
        let n = 0n;
        for (const tb of o.tokenBalances ?? []) {
          if (tokenId != null) {
            const id = toBigInt(tb.tokenId);
            if (id !== tokenId) continue;
          }
          n += toBigInt(tb.balance) ?? 0n;
        }
        if (n > 0n) counts.set(who, (counts.get(who) ?? 0n) + n);
      }
      pageKey = page.pageKey || undefined;
      pages++;
    } while (pageKey && pages < MAX_PAGES);
  } catch {
    notMeasured.push({ item, reason: "The holder list could not be fetched." });
    return null;
  }
  if (pageKey) {
    notMeasured.push({ item, reason: `More than ${MAX_PAGES * 50_000} holders; concentration was not computed.` });
    return null;
  }

  const sorted = [...counts.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));
  const total = sorted.reduce((s, [, n]) => s + n, 0n);
  if (total === 0n) {
    notMeasured.push({
      item,
      reason: tokenId != null ? "No holders found for this tokenId." : "No holders found (nothing minted yet, or not indexed yet).",
    });
    return null;
  }
  const owner = args.owner?.toLowerCase();
  const deployer = args.deployer?.toLowerCase();
  const top10 = sorted.slice(0, 10);
  const top10Sum = top10.reduce((s, [, n]) => s + n, 0n);
  const result: HolderConcentration = {
    source: "alchemy_nft_api",
    tokenId: tokenId != null ? tokenId.toString() : null,
    holderCount: sorted.length,
    heldTotal: total.toString(),
    top1Share: ratio(sorted[0][1], total),
    top10Share: ratio(top10Sum, total),
    top: top10.slice(0, 5).map(([a, n]) => ({
      address: getAddress(a),
      count: n.toString(),
      share: ratio(n, total),
      role: a === owner ? "owner" : a === deployer ? "deployer" : null,
    })),
    note: "Shares are of tokens currently held (burn addresses excluded), from an indexer that can lag the chain by a few minutes. Marketplace or staking contracts can appear as large holders.",
  };

  if (result.top1Share >= 0.2) {
    const who = result.top[0].role ? ` (the ${result.top[0].role})` : "";
    flags.push({ code: "TOP_HOLDER_LARGE_SHARE", note: `One address${who} holds ${(result.top1Share * 100).toFixed(1)}% of held tokens.` });
  }
  if (result.top10Share >= 0.5 && result.holderCount > 10) {
    flags.push({ code: "TOP10_HOLD_MAJORITY", note: `The top 10 holders hold ${(result.top10Share * 100).toFixed(1)}% of held tokens (${result.holderCount} holders).` });
  }
  return result;
}
