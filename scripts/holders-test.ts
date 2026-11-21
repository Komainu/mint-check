/**
 * Mint Check v0.13 保有者の偏りのテスト: npx tsx scripts/holders-test.ts
 * 外には接続しない。Alchemy の応答（owners[].ownerAddress, tokenBalances[].tokenId/balance, pageKey）を偽物で返す。
 */
import type { Address } from "viem";
import { alchemyOwnersFetcher, readHolders, type OwnersFetcher, type OwnersPage } from "../lib/products/mint-check/holders";

let failed = 0;
const expect = (label: string, ok: boolean) => {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
};
const C = "0x1111111111111111111111111111111111111111" as Address;
const OWNER = "0x2222222222222222222222222222222222222222" as Address;
const addr = (i: number) => ("0x" + i.toString(16).padStart(40, "0")) as string;
const pagesOf = (pages: OwnersPage[]): OwnersFetcher => async (_c, key) => pages[key ? Number(key) : 0];
const run = async (fetcher: OwnersFetcher | null, extra: Partial<Parameters<typeof readHolders>[0]> = {}) => {
  const flags: { code: string; note: string }[] = [];
  const notMeasured: { item: string; reason: string }[] = [];
  const r = await readHolders({ fetcher, address: C, standard: "ERC-721", owner: OWNER, deployer: null, flags, notMeasured, ...extra });
  return { r, flags, notMeasured, has: (c: string) => flags.some(f => f.code === c) };
};

async function main() {
  console.log("## 1. 鍵の取り出し");
  expect("Alchemy の URL なら作る", alchemyOwnersFetcher("https://base-mainnet.g.alchemy.com/v2/abcDEF_123-x") !== null);
  expect("公開 RPC なら作らない", alchemyOwnersFetcher("https://mainnet.base.org") === null);
  expect("空なら作らない", alchemyOwnersFetcher(undefined) === null);
  expect("http は作らない", alchemyOwnersFetcher("http://base-mainnet.g.alchemy.com/v2/abc") === null);
  expect("似た名前のホストは作らない", alchemyOwnersFetcher("https://base-mainnet.g.alchemy.com.evil.io/v2/abc") === null);

  console.log("\n## 2. 集中しているコレクション（オーナーが25%）");
  const owners = [
    { ownerAddress: OWNER, tokenBalances: [{ tokenId: "1", balance: 30 }] },
    { ownerAddress: "0x0000000000000000000000000000000000000000", tokenBalances: [{ tokenId: "2", balance: 99 }] },
    ...Array.from({ length: 30 }, (_, i) => ({ ownerAddress: addr(100 + i), tokenBalances: [{ tokenId: String(i + 10), balance: i < 9 ? 5 : 2 }] })),
  ];
  // 合計 = 30 + 9*5 + 21*2 = 117
  const a = await run(pagesOf([{ owners }]));
  expect("保有者数 31（ゼロアドレスは除く）", a.r?.holderCount === 31);
  expect("合計 117", a.r?.heldTotal === "117");
  expect("上位1人 25.6%", Math.abs((a.r?.top1Share ?? 0) - 0.2564) < 0.001);
  expect("上位1人はオーナーと印", a.r?.top[0].role === "owner");
  expect("上位10人 = (30+45)/117 = 64.1%", Math.abs((a.r?.top10Share ?? 0) - 0.641) < 0.001);
  expect("TOP_HOLDER_LARGE_SHARE（オーナーと書く）", a.has("TOP_HOLDER_LARGE_SHARE") && a.flags[0].note.includes("owner"));
  expect("TOP10_HOLD_MAJORITY", a.has("TOP10_HOLD_MAJORITY"));
  expect("上位は5人まで載せる", a.r?.top.length === 5);
  expect("結果に URL や鍵を含まない", !JSON.stringify(a.r).includes("alchemy.com"));

  console.log("\n## 3. 分散しているコレクション（2ページ）");
  const spread = (from: number) => Array.from({ length: 100 }, (_, i) => ({ ownerAddress: addr(from + i), tokenBalances: [{ tokenId: String(from + i), balance: 1 }] }));
  const b = await run(pagesOf([{ owners: spread(1000), pageKey: "1" }, { owners: spread(2000) }]));
  expect("2ページを合わせて200人", b.r?.holderCount === 200);
  expect("偏りの注意なし", !b.has("TOP_HOLDER_LARGE_SHARE") && !b.has("TOP10_HOLD_MAJORITY"));

  console.log("\n## 4. 大きすぎるコレクション");
  const c = await run(pagesOf([{ owners: spread(1), pageKey: "1" }, { owners: spread(200), pageKey: "2" }, { owners: spread(400) }]));
  expect("上限を超えたら割合を出さない", c.r === null && c.notMeasured.some(n => n.item === "mint.holderConcentration"));

  console.log("\n## 5. ERC-1155 の tokenId 指定");
  const multi = [
    { ownerAddress: addr(1), tokenBalances: [{ tokenId: "7", balance: 8 }, { tokenId: "8", balance: 100 }] },
    { ownerAddress: addr(2), tokenBalances: [{ tokenId: "0x7", balance: "2" }] },
  ];
  const d = await run(pagesOf([{ owners: multi }]), { standard: "ERC-1155", tokenId: 7n });
  expect("tokenId 7 だけ数える（16進の番号も同じとみなす）", d.r?.heldTotal === "10" && d.r?.holderCount === 2 && d.r?.tokenId === "7");
  expect("少人数（10人以下）では上位10人の注意を出さない", !d.has("TOP10_HOLD_MAJORITY") && d.has("TOP_HOLDER_LARGE_SHARE"));

  console.log("\n## 6. 測れないとき");
  const e = await run(null);
  expect("Alchemy でなければ notMeasured", e.r === null && e.notMeasured[0].item === "mint.holderConcentration");
  const f = await run(async () => {
    throw new Error("429");
  });
  expect("取得失敗は notMeasured（点検は続く）", f.r === null && f.notMeasured[0].reason.includes("could not be fetched"));
  const g = await run(pagesOf([{ owners: [] }]));
  expect("保有者ゼロは notMeasured", g.r === null && g.notMeasured.length === 1);
  const h = await run(pagesOf([{ owners: multi }]), { standard: "unknown" });
  expect("NFT でなければ測らない", h.r === null);

  console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
  process.exit(failed ? 1 : 0);
}
void main();
