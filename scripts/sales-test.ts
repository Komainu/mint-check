/**
 * 売上の記録のテスト: npx tsx scripts/sales-test.ts
 * Notion には接続せず、送る中身を横取りして確かめる。
 */
import { x402ResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { saleFromSettlement, notionPageBody, writeSale, attachSalesLog, type Sale } from "../lib/shop/sales-log";

let failed = 0;
const expect = (label: string, ok: boolean) => {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
};

const OWNER = "0xe0f8476aee274ca1dd3176949d5c277350a96238";
const BUYER = "0xC9C7b38c0942914fc8ea12063bc92dcd3b581670";
const TX = "0x9d482824ab3b5cb8e85af323bbd9a8292a6a8bbbbce156db7afcd2218c22a209";
const requirements = {
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "20000",
  payTo: "0xCBD946D0Dc0AD404939f5868D8d6EFEdaDA0F7e3",
  maxTimeoutSeconds: 300,
  extra: { name: "USD Coin", version: "2" },
};
const payload = (url: string) => ({
  x402Version: 2,
  resource: { url, description: "", mimeType: "application/json" },
  accepted: requirements,
  payload: { signature: "0x" + "11".repeat(65), authorization: {} },
});
const ok = (payer = BUYER) => ({ success: true, transaction: TX, network: "eip155:8453", payer });

type Captured = { url: string; init: RequestInit };
function fakeFetch(status = 200, captured: Captured[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(status === 200 ? "{}" : '{"message":"bad"}', { status });
  }) as unknown as typeof fetch;
}

(async () => {
  console.log("## 売上の中身");
  const at = new Date("2026-11-16T12:02:24Z"); // = 21:02:24 JST
  const s = saleFromSettlement(
    { result: ok(), requirements, paymentPayload: payload("https://mint-check.vercel.app/api/mint-check?address=0x1") } as never,
    at,
  )!;
  expect("商品名を URL のパスから引く", s.productName === "Mint Check");
  expect("金額 20000 → 0.02 USDC", s.amountUsdc === 0.02);
  expect("購入者は小文字にそろえる", s.payer === BUYER.toLowerCase());
  expect("取引とネットワーク", s.transaction === TX && s.network === "eip155:8453");
  expect("決済失敗は記録しない",
    saleFromSettlement({ result: { ...ok(), success: false }, requirements, paymentPayload: payload("https://x/api/mint-check") } as never) === null);
  const unknown = saleFromSettlement({ result: ok(), requirements, paymentPayload: payload("https://x/api/other") } as never)!;
  expect("知らないパスでも記録はする（商品名はパス）", unknown.productName === "/api/other");

  console.log("\n## Notion に送る中身");
  const body = notionPageBody(s, "ds-1", OWNER) as {
    parent: { type: string; data_source_id: string };
    properties: Record<string, any>;
  };
  expect("親は data source", body.parent.type === "data_source_id" && body.parent.data_source_id === "ds-1");
  expect("記録の名前は日本時間", body.properties["記録"].title[0].text.content === "2026-11-16 21:02 Mint Check");
  expect("日時は日本時間（+09:00）", body.properties["日時"].date.start === "2026-11-16T21:02:24+09:00");
  expect("外部客", body.properties["区分"].select.name === "外部客");
  expect("Basescan のリンク", body.properties["取引"].url === "https://basescan.org/tx/" + TX);
  expect("記録元は API自動", body.properties["記録元"].select.name === "API自動");
  const own = notionPageBody({ ...s, payer: OWNER } as Sale, "ds-1", OWNER.toUpperCase().replace("0X", "0x")) as any;
  expect("運営者の購入は「運営者」", own.properties["区分"].select.name === "運営者");

  console.log("\n## 書き込み");
  const saved = { ...process.env };
  delete process.env.NOTION_TOKEN;
  let calls: Captured[] = [];
  expect("キーがなければ何もしない", (await writeSale(s, fakeFetch(200, calls))) === false && calls.length === 0);
  process.env.NOTION_TOKEN = "secret_test";
  calls = [];
  expect("キーがあれば書く", (await writeSale(s, fakeFetch(200, calls))) === true && calls.length === 1);
  const h = calls[0].init.headers as Record<string, string>;
  expect("送り先と認証・版の指定", calls[0].url === "https://api.notion.com/v1/pages" && h.Authorization === "Bearer secret_test" && h["Notion-Version"] === "2025-09-03");
  expect("既定の売上記録に書く", JSON.parse(String(calls[0].init.body)).parent.data_source_id === "41bd7043-0798-81bb-92cc-000b06f6cd5f");
  const logs: string[] = [];
  const origErr = console.error;
  console.error = (...a: unknown[]) => logs.push(a.join(" "));
  expect("Notion が拒否しても例外を投げない", (await writeSale(s, fakeFetch(400))) === false);
  const throwing = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  expect("通信できなくても例外を投げない", (await writeSale(s, throwing)) === false);
  console.error = origErr;
  expect("失敗はログに残す（キーは出さない）", logs.length === 2 && logs.every(l => l.startsWith("[sales-log]")) && !logs.join().includes("secret_test"));

  console.log("\n## 決済の流れの中で記録されるか");
  // 本物の料金所に代役のファシリテーターをつなぎ、決済を成立させる
  const network = "eip155:8453" as const;
  const fakeFacilitator = {
    async getSupported() { return { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} }; },
    async verify() { return { isValid: true, payer: BUYER }; },
    async settle() { return ok(); },
  };
  const server = new x402ResourceServer(fakeFacilitator as never).register(network, new ExactEvmScheme());
  attachSalesLog(server);
  await server.initialize();
  const posted: Captured[] = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch(200, posted);
  const p = payload("https://mint-check.vercel.app/api/mint-check?address=0x1");
  const result = await server.settlePayment(p as never, requirements as never);
  await new Promise(r => setTimeout(r, 50)); // 待たずに書く分が終わるのを待つ
  globalThis.fetch = origFetch;
  expect("決済は成功のまま", result.success === true);
  expect("決済のあとで Notion に1件書いた", posted.length === 1 && posted[0].url === "https://api.notion.com/v1/pages");
  const sent = JSON.parse(String(posted[0]?.init.body ?? "{}"));
  expect("書いた中身は Mint Check・外部客・0.02",
    sent.properties?.["商品"]?.select?.name === "Mint Check" &&
      sent.properties?.["区分"]?.select?.name === "外部客" &&
      sent.properties?.["金額(USDC)"]?.number === 0.02);

  // Notion が落ちていても決済は成功する
  globalThis.fetch = (async () => { throw new Error("notion down"); }) as unknown as typeof fetch;
  console.error = () => {};
  const result2 = await server.settlePayment(p as never, requirements as never);
  await new Promise(r => setTimeout(r, 50));
  console.error = origErr;
  globalThis.fetch = origFetch;
  expect("Notion に書けなくても決済は成功のまま", result2.success === true);

  process.env = saved;
  console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
  if (failed) process.exitCode = 1;
})();
