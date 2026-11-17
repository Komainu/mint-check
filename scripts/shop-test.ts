/**
 * 店全体のテスト: npx tsx scripts/shop-test.ts
 *  1. 料金所の設定（環境変数の組み合わせ）
 *  2. 全商品について: カタログの条件、OpenSea 公式の検証、402 応答（GET・POST）、警告の有無
 *  3. Mint Check の出力が OpenSea 登録時（v0.5）と1文字も変わっていないこと
 *  4. 入力の読み取り（GET のクエリ・POST の JSON 本文）
 * 本物のファシリテーターには接続せず、代役を使う。
 */
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { validateManifest, computeManifestHash, deriveSlug } from "@opensea/tool-sdk";
import { isValidServiceName, sanitizeTags, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { getPaymentSettings } from "../lib/shop/payment";
import { buildManifest, buildRoutes, manifestPath, priceToBaseUnits, PUBLIC_ORIGIN, CREATOR_ADDRESS } from "../lib/shop/catalog";
import { readInput } from "../lib/shop/paid-route";
import { productPath, type Product } from "../lib/shop/types";
import { PRODUCTS, findProduct } from "../lib/products";

const PAY = "0xCBD946D0Dc0AD404939f5868D8d6EFEdaDA0F7e3";
const ENV_KEYS = ["PAY_TO", "X402_NETWORK", "FACILITATOR_URL", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "PRICE"];

let failed = 0;
function expect(label: string, ok: boolean) {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
}
function withEnv<T>(env: Record<string, string>, fn: () => T): T {
  const saved = { ...process.env };
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    process.env = saved;
  }
}
const PROD_ENV = { PAY_TO: PAY, X402_NETWORK: "eip155:8453", CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "secret" };

async function gate(product: Product, method: "GET" | "POST", input?: Record<string, string>) {
  const network = "eip155:8453" as const;
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => warnings.push(a.join(" "));
  try {
    const fake = {
      async getSupported() {
        return { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} };
      },
      async verify() { throw new Error("not used"); },
      async settle() { throw new Error("not used"); },
    };
    const server = new x402ResourceServer(fake as never).register(network, new ExactEvmScheme());
    server.registerExtension(bazaarResourceServerExtension);
    const routes = withEnv(PROD_ENV, () => buildRoutes(product));
    const http = new x402HTTPResourceServer(server, routes as never);
    await http.initialize();
    const path = productPath(product);
    const example = input ?? (product.bazaar.inputExample as Record<string, string>);
    const query = method === "GET" ? example : {};
    const url = `https://mint-check.vercel.app${path}${method === "GET" ? "?" + new URLSearchParams(query) : ""}`;
    const adapter = {
      getHeader: () => undefined,
      getMethod: () => method,
      getPath: () => path,
      getUrl: () => url,
      getAcceptHeader: () => "application/json",
      getUserAgent: () => "shop-test",
      getQueryParams: () => query,
      getQueryParam: (n: string) => query[n],
      getBody: async () => (method === "POST" ? example : undefined),
    };
    const r = (await http.processHTTPRequest({ adapter: adapter as never, path, method })) as {
      type: string;
      response?: { status: number; headers: Record<string, string> };
    };
    const h = r.response?.headers["PAYMENT-REQUIRED"] ?? r.response?.headers["payment-required"];
    return {
      status: r.response?.status,
      type: r.type,
      paymentRequired: h ? Buffer.from(h, "base64").toString("utf8") : "",
      warnings,
    };
  } finally {
    console.warn = origWarn;
  }
}

(async () => {
  console.log("## 1. 料金所の設定");
  const kind = (r: unknown) => (r as { facilitator: { kind: string } }).facilitator.kind;
  const tryGet = (env: Record<string, string>) => {
    try {
      return { r: withEnv(env, getPaymentSettings), e: undefined as Error | undefined };
    } catch (e) {
      return { r: undefined, e: e as Error };
    }
  };
  expect("練習用・キーなし → 練習用ファシリテーター", kind(tryGet({ PAY_TO: PAY }).r) === "url");
  expect("本番・キーあり → CDP", kind(tryGet(PROD_ENV).r) === "cdp");
  expect("本番・キーなし → エラー", /本番/.test(tryGet({ PAY_TO: PAY, X402_NETWORK: "eip155:8453" }).e?.message ?? ""));
  expect("キーが片方だけ → エラー", /両方/.test(tryGet({ PAY_TO: PAY, CDP_API_KEY_ID: "id" }).e?.message ?? ""));
  expect("PAY_TO なし → エラー", /PAY_TO/.test(tryGet({}).e?.message ?? ""));
  expect("価格の換算 $0.02 → 20000", priceToBaseUnits("$0.02") === "20000" && priceToBaseUnits("$1") === "1000000");

  console.log("\n## 2. 全商品の検査");
  const slugs = new Set<string>();
  for (const p of PRODUCTS) {
    console.log(`--- ${p.slug}`);
    expect("slug が重複しない", !slugs.has(p.slug));
    slugs.add(p.slug);
    expect("slug の形（英小文字・数字・ハイフン）", /^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug));
    expect(`slug が表示名から作る OpenSea のスラッグと一致（${deriveSlug(p.serviceName)}）`, deriveSlug(p.serviceName) === p.slug);
    expect("findProduct で見つかる", findProduct(p.slug) === p);
    expect(`表示名がカタログの条件を満たす（${p.serviceName}）`, isValidServiceName(p.serviceName));
    expect(`説明文が500文字以内（${p.description.length}文字）`, p.description.length <= 500);
    expect("タグが削られずに全部残る", JSON.stringify(sanitizeTags(p.tags)) === JSON.stringify(p.tags));
    expect("入力例のキーが入力の形に含まれる",
      Object.keys(p.bazaar.inputExample).every(k => k in p.bazaar.inputSchema.properties));

    const m = withEnv(PROD_ENV, () => buildManifest(p));
    const v = validateManifest(m);
    expect("マニフェストが OpenSea 公式の検証に通る", v.success === true);
    expect("マニフェストとAPIが同じ起点", new URL(m.endpoint).origin === new URL(PUBLIC_ORIGIN + manifestPath(p)).origin);
    expect("creatorAddress が小文字", m.creatorAddress === CREATOR_ADDRESS && m.creatorAddress === m.creatorAddress.toLowerCase());
    expect("受取先は PAY_TO", m.pricing[0].recipient === `eip155:8453:${PAY.toLowerCase()}`);

    const g = await gate(p, "GET");
    expect("GET: 支払いなしなら402", g.type === "payment-error" && g.status === 402);
    const body = g.paymentRequired ? JSON.parse(g.paymentRequired) : {};
    expect("402 に表示名・タグ・説明が載る",
      body.resource?.serviceName === p.serviceName &&
        JSON.stringify(body.resource?.tags) === JSON.stringify(p.tags) &&
        body.resource?.description === p.description);
    expect("402 の金額がマニフェストの価格と一致", body.accepts?.[0]?.amount === m.pricing[0].amount);
    expect("ワイルドカードの警告が出ない", !g.warnings.some(w => w.includes("Wildcard")));
    const post = await gate(p, "POST");
    expect("POST: 支払いなしなら402", post.type === "payment-error" && post.status === 402);
  }

  console.log("\n## 3. Mint Check が OpenSea 登録時と同じか");
  const golden = JSON.parse(readFileSync(new URL("./fixtures/mint-check-v0.5.json", import.meta.url), "utf8"));
  const mc = findProduct("mint-check")!;
  const m = withEnv(PROD_ENV, () => buildManifest(mc));
  const hash = computeManifestHash(m as never);
  expect(`マニフェストのハッシュが登録済みと一致（${hash.slice(0, 10)}…）`, hash === golden.manifestHash);
  expect("マニフェストが1文字も変わっていない", JSON.stringify(m) === golden.manifest);
  expect("Bazaar 用のルート設定が変わっていない", JSON.stringify(withEnv(PROD_ENV, () => buildRoutes(mc))) === golden.routes);
  // 基準は address=0xBa5e… で呼んだときに記録したので、同じ呼び方で比べる
  const g = await gate(mc, "GET", { address: "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83" });
  expect("402 応答が変わっていない", g.paymentRequired === golden.paymentRequired);

  console.log("\n## 4. 入力の読み取り");
  const A = "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83";
  const keys = ["address", "tokenId"];
  const gi = await readInput(new NextRequest(`https://x.test/api/mint-check?address=${A}&tokenId=1&extra=1`), keys);
  expect("GET: クエリから読む（知らないキーは無視）", !("error" in gi) && gi.address === A && gi.tokenId === "1" && !("extra" in gi));
  const pi = await readInput(new NextRequest("https://x.test/api/mint-check", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: A, tokenId: 7 }),
  }), keys);
  expect("POST: JSON本文から読む（数値も文字列に）", !("error" in pi) && pi.address === A && pi.tokenId === "7");
  const bad = await readInput(new NextRequest("https://x.test/api/mint-check", { method: "POST", body: "not json" }), keys);
  expect("POST: JSONでなければエラー", "error" in bad);
  const arr = await readInput(new NextRequest("https://x.test/api/mint-check", { method: "POST", body: "[1]" }), keys);
  expect("POST: 配列はエラー", "error" in arr);

  console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
  if (failed) process.exitCode = 1;
})();
