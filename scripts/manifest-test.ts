/**
 * OpenSea（ERC-8257）用マニフェストと POST 入力のテスト: npx tsx scripts/manifest-test.ts
 * マニフェストは OpenSea 公式 SDK の検証関数で確かめる。
 */
import { validateManifest, computeManifestHash, deriveSlug } from "@opensea/tool-sdk";
import { NextRequest } from "next/server";
import { buildManifest, priceToBaseUnits, TOOL_SLUG, MANIFEST_PATH, PUBLIC_ORIGIN, CREATOR_ADDRESS } from "../lib/manifest";
import { readInput } from "../lib/input";

let failed = 0;
const expect = (label: string, ok: boolean) => {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
};

(async () => {
  // 価格の換算
  expect("$0.02 → 20000", priceToBaseUnits("$0.02") === "20000");
  expect("0.5 → 500000", priceToBaseUnits("0.5") === "500000");
  expect("$1 → 1000000", priceToBaseUnits("$1") === "1000000");

  // 本番設定でのマニフェスト
  process.env.PAY_TO = "0xCBD946D0Dc0AD404939f5868D8d6EFEdaDA0F7e3";
  process.env.X402_NETWORK = "eip155:8453";
  process.env.CDP_API_KEY_ID = "id";
  process.env.CDP_API_KEY_SECRET = "secret";
  delete process.env.PRICE;
  const m = buildManifest();
  const v = validateManifest(m);
  expect("OpenSea公式の検証に通る", v.success === true);
  if (!v.success) console.log(JSON.stringify((v as { error?: unknown }).error, null, 2).slice(0, 1500));
  expect(`スラッグが名前と一致（${deriveSlug(m.name)}）`, deriveSlug(m.name) === TOOL_SLUG);
  const origin = new URL(m.endpoint).origin;
  expect("マニフェストとAPIが同じ起点", origin === new URL(PUBLIC_ORIGIN + MANIFEST_PATH).origin);
  expect("creatorAddress が小文字", m.creatorAddress === m.creatorAddress.toLowerCase() && m.creatorAddress === CREATOR_ADDRESS);
  expect("価格 20000（0.02 USDC）", m.pricing[0].amount === "20000");
  expect("資産は Base 本番の USDC", m.pricing[0].asset === "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
  expect("受取先は PAY_TO", m.pricing[0].recipient === "eip155:8453:0xcbd946d0dc0ad404939f5868d8d6efedada0f7e3");
  const hash = computeManifestHash(m as never);
  expect("ハッシュが計算できる", /^0x[0-9a-f]{64}$/.test(hash));
  expect("同じ設定なら同じハッシュ", computeManifestHash(buildManifest() as never) === hash);
  console.log(`    manifest hash: ${hash}`);

  // 入力の読み取り
  const A = "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83";
  const g = await readInput(new NextRequest(`https://x.test/api/mint-check?address=${A}&tokenId=1`));
  expect("GET: クエリから読む", !("error" in g) && g.address === A && g.tokenId === "1");
  const p = await readInput(new NextRequest("https://x.test/api/mint-check", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: A, tokenId: 7 }),
  }));
  expect("POST: JSON本文から読む（数値の tokenId も可）", !("error" in p) && p.address === A && p.tokenId === "7");
  const bad = await readInput(new NextRequest("https://x.test/api/mint-check", { method: "POST", body: "not json" }));
  expect("POST: JSONでなければエラー", "error" in bad);

  console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
  if (failed) process.exitCode = 1;
})();
