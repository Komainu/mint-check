/** 商品一覧（/openapi.json・/.well-known/x402）のテスト: npx tsx scripts/discovery-test.ts */
import { PRODUCTS } from "../lib/products";
import { buildOpenApi, buildWellKnownX402, priceToUsdString } from "../lib/shop/discovery";
import { productPath } from "../lib/shop/types";

let failed = 0;
const expect = (label: string, ok: boolean) => {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
};

expect("$0.02 → 0.02", priceToUsdString("$0.02") === "0.02");
expect("0.5 → 0.5", priceToUsdString("0.5") === "0.5");
let threw = false;
try { priceToUsdString("free"); } catch { threw = true; }
expect("おかしな価格は例外", threw);

const doc: any = buildOpenApi(PRODUCTS, "9.9.9");
expect("openapi と info", doc.openapi === "3.0.3" && !!doc.info.title && doc.info.version === "9.9.9");
expect("商品の数だけ path", Object.keys(doc.paths).length === PRODUCTS.length);
for (const p of PRODUCTS) {
  const path = `/api/${p.slug}`;
  const item = doc.paths[path];
  expect(`${p.slug}: 店のルートと同じ path`, !!item && productPath(p) === path);
  for (const m of ["get", "post"]) {
    const op = item[m];
    expect(`${p.slug} ${m}: x-payment-info（x402・固定・USD）`, op["x-payment-info"].protocols[0] === "x402" && op["x-payment-info"].price.mode === "fixed" && op["x-payment-info"].price.currency === "USD");
    expect(`${p.slug} ${m}: 価格は商品と同じ`, op["x-payment-info"].price.amount === priceToUsdString(p.price()));
    expect(`${p.slug} ${m}: 402 応答あり`, !!op.responses["402"]);
  }
  const req = p.bazaar.inputSchema.required ?? [];
  expect(`${p.slug}: 必須の入力が GET の query に required で載る`, req.every(r => item.get.parameters.some((q: any) => q.name === r && q.required === true && q.in === "query")));
  expect(`${p.slug}: POST の本文に例`, !!item.post.requestBody.content["application/json"].example);
}
const ops = Object.values(doc.paths).flatMap((i: any) => [i.get.operationId, i.post.operationId]);
expect("operationId が重ならない", new Set(ops).size === ops.length);
const wk = buildWellKnownX402(PRODUCTS);
expect("well-known: version 1 と全商品の URL", wk.version === 1 && wk.resources.length === PRODUCTS.length && wk.resources.every(u => u.startsWith("https://")));

console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
process.exit(failed ? 1 : 0);
