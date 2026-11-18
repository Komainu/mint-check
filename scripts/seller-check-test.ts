/**
 * x402 Seller Check のテスト: npx tsx scripts/seller-check-test.ts
 * 外には接続しない。402 の応答とオンチェーンの読み取りは偽物で置き換える。
 * 本物の 402 として、Mint Check の OpenSea 登録時の応答（fixtures）を使う。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PublicClient } from "viem";
import { runSellerCheck, decodePaymentRequired } from "../lib/products/x402-seller-check/checks";
import { isBlockedAddress, validateTargetUrl, guardedLookup, type ProbeResponse } from "../lib/products/x402-seller-check/probe";
import { x402SellerCheck } from "../lib/products/x402-seller-check/product";

let failed = 0;
const expect = (label: string, ok: boolean) => {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
};

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/mint-check-v0.5.json"), "utf8"));
const goldenPR: Record<string, unknown> =
  typeof fixture.paymentRequired === "string" ? JSON.parse(fixture.paymentRequired) : fixture.paymentRequired;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const v2Response = (pr: unknown, status = 402): ProbeResponse => ({
  status,
  headers: { "payment-required": Buffer.from(JSON.stringify(pr)).toString("base64") },
  body: "{}",
  latencyMs: 120,
});

/** 偽のチェーン: トークンの EIP-712 名と、受取先のコード */
function fakeClient(token: { name: string | null; version: string | null; has5267?: boolean }, payToCode = "0x6001"): PublicClient {
  return {
    async readContract({ functionName }: { functionName: string }) {
      if (functionName === "eip712Domain") {
        if (!token.has5267) throw new Error("no 5267");
        return ["0x0f", token.name, token.version, 8453n, "0x0", "0x0", []];
      }
      const v = functionName === "name" ? token.name : token.version;
      if (v === null) throw new Error("revert");
      return v;
    },
    async getCode() {
      return payToCode;
    },
  } as unknown as PublicClient;
}

const usdcBase = fakeClient({ name: "USD Coin", version: "2" });
const called = new URL("https://mint-check.vercel.app/api/mint-check?address=0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83");
const run = (res: ProbeResponse | Error, clients = { "eip155:8453": usdcBase }, url = called) =>
  runSellerCheck(url, "GET", {
    prober: async () => {
      if (res instanceof Error) throw res;
      return res;
    },
    clients,
    now: () => new Date("2026-11-19T00:00:00Z"),
  });
type Ok = Extract<Awaited<ReturnType<typeof run>>, { unreachable: false }>;
const body = (r: Awaited<ReturnType<typeof run>>) => (r as Ok).body;
const has = (r: Awaited<ReturnType<typeof run>>, id: string, status: string) =>
  body(r).checks.some(c => c.id === id && c.status === status);

async function main() {
console.log("## 1. 入力の検査（内部アドレスに繋がない）");
for (const bad of [
  "http://example.com/x",
  "https://localhost/x",
  "https://127.0.0.1/x",
  "https://10.0.0.5/x",
  "https://169.254.169.254/latest/meta-data",
  "https://[::1]/x",
  "https://example.com:8443/x",
  "https://user:pw@example.com/x",
  "https://metadata.google.internal/x",
  "not a url",
]) expect(`拒否: ${bad}`, "error" in validateTargetUrl(bad));
expect("空は拒否", "error" in validateTargetUrl(null));
expect("普通の https は通す", !("error" in validateTargetUrl("https://mint-check.vercel.app/api/mint-check")));
for (const ip of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::ffff:127.0.0.1", "fd00::1", "fe80::1"]) {
  expect(`内部アドレス: ${ip}`, isBlockedAddress(ip));
}
for (const ip of ["76.76.21.21", "8.8.8.8", "2606:4700::1111"]) expect(`外部アドレス: ${ip}`, !isBlockedAddress(ip));

await new Promise<void>(resolve => {
  guardedLookup("localhost", {}, err => {
    expect("DNS で localhost に解決したら接続を止める", (err as { code?: string } | null)?.code === "EBLOCKED");
    resolve();
  });
});

console.log("\n## 2. 本物の 402（Mint Check）");
const r1 = await run(v2Response(goldenPR));
const b1 = body(r1);
expect("結果は payable", b1.result === "payable");
expect("v2 ヘッダーとして読む", b1.x402.version === 2 && b1.x402.source === "header");
expect("価格 0.02 USD", b1.accepts[0].priceUsd === 0.02);
expect("USDC on Base と表示", b1.accepts[0].assetLabel === "USDC on Base");
expect("受取先はコントラクト", b1.accepts[0].payToKind === "contract");
expect("EIP-712 一致", (b1.accepts[0].eip712 as { match: boolean }).match === true);
expect("説明文は pass", has(r1, "description", "pass"));
expect("resource.url は pass", has(r1, "resource_url", "pass"));
expect("Bazaar は pass", has(r1, "bazaar", "pass"));
expect("表示名とタグを読む", b1.resource.serviceName === "Mint Check" && b1.resource.tags.length === 5);
expect("fail なし", b1.summary.fail === 0);
expect("払った後のことは測れないと書く", b1.notMeasured.some(n => n.item === "delivery_after_payment"));
const eoa = await run(v2Response(goldenPR), { "eip155:8453": fakeClient({ name: "USD Coin", version: "2" }, "0x") });
expect("コードが無い受取先は EOA", body(eoa).accepts[0].payToKind === "eoa");
const d7702 = await run(v2Response(goldenPR), { "eip155:8453": fakeClient({ name: "USD Coin", version: "2" }, "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b") });
expect("EIP-7702 委任は EOA として区別", body(d7702).accepts[0].payToKind === "eoa_7702_delegated");
const via5267 = await run(v2Response(goldenPR), { "eip155:8453": fakeClient({ name: "USD Coin", version: "2", has5267: true }) });
expect("eip712Domain() からも読める", (body(via5267).accepts[0].eip712 as { match: boolean }).match === true);

console.log("\n## 3. 実際に起きた失敗を見つける");
{
  const pr = clone(goldenPR) as any;
  pr.accepts[0].extra = { name: "USDC", version: "2" };
  const r = await run(v2Response(pr));
  expect("EIP-712 名の不一致は fail", has(r, "accepts[0].eip712", "fail") && body(r).result === "has_problems");
}
{
  const pr = clone(goldenPR) as any;
  pr.accepts[0].extra = {};
  expect("extra.name が無いと fail", has(await run(v2Response(pr)), "accepts[0].eip712", "fail"));
}
{
  const pr = clone(goldenPR) as any;
  pr.resource.description = "x".repeat(506);
  const r = await run(v2Response(pr));
  expect("説明文 506 文字は fail（CDP の上限 500）", has(r, "description", "fail"));
}
{
  const pr = clone(goldenPR) as any;
  pr.resource.url = "http://localhost:3000/api/mint-check";
  expect("resource.url が http は fail", has(await run(v2Response(pr)), "resource_url", "fail"));
  pr.resource.url = "https://old-domain.example/api/mint-check";
  expect("resource.url の別ドメインは warn", has(await run(v2Response(pr)), "resource_url", "warn"));
}
{
  const pr = clone(goldenPR) as any;
  delete pr.extensions;
  const r = await run(v2Response(pr));
  expect("Bazaar 情報なしは warn", has(r, "bazaar", "warn") && body(r).result === "payable_with_warnings");
}
{
  const pr = clone(goldenPR) as any;
  pr.accepts[0].payTo = "0x0000000000000000000000000000000000000000";
  expect("受取先がゼロアドレスは fail", has(await run(v2Response(pr)), "accepts[0].payTo", "fail"));
  pr.accepts[0].payTo = "0x1234";
  expect("受取先が不正は fail", has(await run(v2Response(pr)), "accepts[0].payTo", "fail"));
}
{
  const pr = clone(goldenPR) as any;
  pr.accepts[0].amount = "0.02";
  expect("金額が小数は fail", has(await run(v2Response(pr)), "accepts[0].amount", "fail"));
}
{
  const pr = clone(goldenPR) as any;
  pr.accepts = [];
  expect("accepts が空は not_payable", body(await run(v2Response(pr))).result === "not_payable");
}
{
  const pr = clone(goldenPR) as any;
  pr.accepts[0].asset = "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed";
  expect("USDC 以外の資産は warn", has(await run(v2Response(pr)), "accepts[0].asset", "warn"));
}
{
  const pr = clone(goldenPR) as any;
  pr.accepts.push({ ...pr.accepts[0], network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", asset: "EPj", payTo: "So1" });
  pr.accepts.push({ ...pr.accepts[0], network: "eip155:137", asset: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" });
  const r = await run(v2Response(pr));
  expect("Solana は情報だけ", has(r, "accepts[1].network", "info"));
  expect("Polygon は価格を出す", body(r).accepts[2].priceUsd === 0.02);
  expect("Polygon のオンチェーンは測れないと書く", body(r).notMeasured.some(n => n.item === "accepts[2].onchain"));
}

console.log("\n## 4. 402 でない・壊れている");
{
  const r = await run({ status: 200, headers: {}, body: "{\"ok\":true}", latencyMs: 50 });
  expect("200 は not_payable", body(r).result === "not_payable" && has(r, "answers_402", "fail"));
}
{
  const r = await run({ status: 302, headers: { location: "https://other.example/pay" }, body: "", latencyMs: 50 });
  expect("リダイレクトは行き先を報告", body(r).http.redirectTo === "https://other.example/pay" && has(r, "answers_402", "fail"));
}
{
  const r = await run({ status: 402, headers: {}, body: "pay me", latencyMs: 50 });
  expect("条件のない 402 は fail", has(r, "payment_required", "fail") && body(r).result === "not_payable");
}
{
  const r = await run({ status: 402, headers: { "payment-required": "!!!notbase64json" }, body: "", latencyMs: 50 });
  expect("壊れたヘッダーは fail", has(r, "payment_required", "fail"));
}
{
  const blocked = Object.assign(new Error("blocked"), { code: "EBLOCKED" });
  const r = await run(blocked);
  expect("内部アドレスに解決したら unreachable", r.unreachable === true && r.reason.includes("private"));
  const timeout = await run(Object.assign(new Error("t"), { code: "ETIMEOUT" }));
  expect("時間切れは unreachable", timeout.unreachable === true);
}

console.log("\n## 5. x402 v1（本文に条件）");
{
  const v1 = {
    x402Version: 1,
    error: "X-PAYMENT header is required",
    accepts: [
      {
        scheme: "exact",
        network: "base",
        maxAmountRequired: "5000",
        resource: "https://mint-check.vercel.app/api/mint-check",
        description: "A v1 seller",
        mimeType: "application/json",
        payTo: "0xCBD946D0Dc0AD404939f5868D8d6EFEdaDA0F7e3",
        maxTimeoutSeconds: 60,
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        extra: { name: "USD Coin", version: "2" },
      },
    ],
  };
  const res = { status: 402, headers: {}, body: JSON.stringify(v1), latencyMs: 80 };
  expect("v1 本文を読む", decodePaymentRequired(res).source === "body");
  const r = await run(res);
  expect("v1: 版は 1", body(r).x402.version === 1);
  expect("v1: base を eip155:8453 に読み替え", body(r).accepts[0].network === "eip155:8453");
  expect("v1: 価格 0.005 USD", body(r).accepts[0].priceUsd === 0.005);
  expect("v1: EIP-712 一致", (body(r).accepts[0].eip712 as { match: boolean }).match === true);
  expect("v1: 説明文と resource を拾う", body(r).resource.description === "A v1 seller" && has(r, "resource_url", "pass"));
}

console.log("\n## 6. 実在の店の 402 を再現（2026-11-19 に支払いなしで取得した値）");
{
  const sepolia = fakeClient({ name: "USDC", version: "2" }, "0x");
  // Base Sepolia の USDC の EIP-712 名は "USDC"（本番の "USD Coin" ではない）。写し間違いの定番
  const pr = clone(goldenPR) as any;
  pr.accepts[0] = { ...pr.accepts[0], network: "eip155:84532", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" };
  const r = await run(v2Response(pr), { "eip155:84532": sepolia } as any);
  expect("Sepolia で USD Coin と書くと fail", has(r, "accepts[0].eip712", "fail"));
  expect("Sepolia の価格も出す", body(r).accepts[0].priceUsd === 0.02);
}
{
  // Blackwood: exact と upto(permit2) の2つ。permit2 は EIP-712 名の点検をしない
  const pr = {
    x402Version: 2,
    resource: { url: "https://x402-gateway.blackwoodstate8.workers.dev/v1/x402-check", description: "x402 endpoint check", mimeType: "application/json", serviceName: "x402 Endpoint Check | Blackwood" },
    accepts: [
      { scheme: "exact", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "7000", payTo: "0x9e32E6163ac2cDfF1405746918e00d16F6E0A0de", maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } },
      { scheme: "upto", network: "eip155:8453", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: "7000", payTo: "0x9e32E6163ac2cDfF1405746918e00d16F6E0A0de", maxTimeoutSeconds: 60, extra: { assetTransferMethod: "permit2", name: "USD Coin", version: "2" } },
    ],
  };
  const r = await run(v2Response(pr), { "eip155:8453": fakeClient({ name: "USD Coin", version: "2" }, "0x") }, new URL("https://x402-gateway.blackwoodstate8.workers.dev/v1/x402-check"));
  expect("Blackwood: 価格 0.007", body(r).accepts[0].priceUsd === 0.007);
  expect("Blackwood: permit2 は EIP-712 を点検しない", body(r).accepts[1].eip712 === null);
  expect("Blackwood: 受取先は EOA", body(r).accepts[0].payToKind === "eoa");
  expect("Blackwood: Bazaar 情報なしとして warn", body(r).result === "payable_with_warnings");
}
{
  // DevX: resource.url にクエリが無いがパスは同じ → pass
  const pr = clone(goldenPR) as any;
  pr.resource.url = "https://tokencheck.madebydevx.com/v1/token/verdict";
  const r = await run(v2Response(pr), { "eip155:8453": usdcBase }, new URL("https://tokencheck.madebydevx.com/v1/token/verdict?address=0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed&chain=base"));
  expect("DevX: クエリ違いは問題にしない", has(r, "resource_url", "pass"));
}

console.log("\n## 7. 商品の入口");
{
  const bad = await x402SellerCheck.run({ url: "http://example.com", method: null });
  expect("http は 400（課金なし）", bad.status === 400);
  const badM = await x402SellerCheck.run({ url: "https://example.com/x", method: "PUT" });
  expect("PUT は 400", badM.status === 400);
  expect("説明文は 500 文字以内", x402SellerCheck.description.length <= 500);
}

console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
process.exit(failed ? 1 : 0);
}

void main();
