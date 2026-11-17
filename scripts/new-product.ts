/**
 * 新しい商品のひな形を作る: npm run new-product -- <slug> "<表示名>"
 *   例: npm run new-product -- holder-check "Holder Check"
 *
 * 作るもの:
 *   lib/products/<slug>/product.ts   商品の定義（説明・タグ・入出力・本体）
 *   app/api/<slug>/route.ts          有料API（3行）
 *   lib/products/index.ts            一覧に追加
 * 作った直後の本体は「未実装（501）」を返す。501 は課金されないが、公開前に必ず中身を書くこと。
 * 書き終えたら npx tsx scripts/shop-test.ts で検査する。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const [slug, serviceName] = process.argv.slice(2);

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!slug || !serviceName) fail('使い方: npm run new-product -- <slug> "<表示名>"');
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail("slug は英小文字・数字・ハイフンで書いてください。");
const derived = serviceName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
if (derived !== slug) fail(`表示名から作るスラッグ（${derived}）が slug と一致しません。OpenSea の決まりに合わせてください。`);
if (!/^[\x20-\x7e]{1,32}$/.test(serviceName)) fail("表示名は ASCII で32文字以内にしてください。");

const varName = slug.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const productDir = join(root, "lib/products", slug);
const routeDir = join(root, "app/api", slug);
if (existsSync(productDir) || existsSync(routeDir)) fail(`${slug} はすでにあります。`);

mkdirSync(productDir, { recursive: true });
writeFileSync(
  join(productDir, "product.ts"),
  `/**
 * 商品: ${serviceName}
 * 企画: 商品台帳（Notion）の該当行を参照。
 * 公開後に説明・タグ・入出力・価格を変えたら manifest.version を上げ、OpenSea の記録も更新すること。
 */
import type { Product } from "@/lib/shop/types";

export const ${varName}: Product = {
  slug: "${slug}",
  serviceName: "${serviceName}",
  // 英語で、何を返すか・何に使うか・何ではないか（投資助言ではない等）を500文字以内で
  description: "TODO: describe what this returns and when an agent should call it. Not financial advice.",
  tags: ["base"], // 最大5個、各32文字以内
  price: () => "$0.01",

  bazaar: {
    inputExample: { address: "0x0000000000000000000000000000000000000000" },
    inputSchema: {
      properties: {
        address: {
          type: "string",
          description: "TODO",
          pattern: "^0x[0-9a-fA-F]{40}$",
        },
      },
      required: ["address"],
    },
    outputExample: { TODO: true },
  },

  manifest: {
    version: "0.1.0",
    inputs: {
      type: "object",
      properties: {
        address: { type: "string", description: "TODO", pattern: "^0x[0-9a-fA-F]{40}$" },
      },
      required: ["address"],
    },
    outputs: { type: "object", properties: {} },
  },

  async run(input) {
    // 入力の検査に失敗したら status 400（課金されない）。外部の失敗は 502。
    void input;
    return { status: 501, body: { error: "Not implemented yet. You were not charged." } };
  },
};
`,
);

mkdirSync(routeDir, { recursive: true });
writeFileSync(
  join(routeDir, "route.ts"),
  `/** ${serviceName} の有料API（GET・POST）。中身は lib/products/${slug}/product.ts。 */
import { createPaidRoute } from "@/lib/shop/paid-route";
import { ${varName} } from "@/lib/products/${slug}/product";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const { GET, POST } = createPaidRoute(${varName});
`,
);

const indexPath = join(root, "lib/products/index.ts");
let index = readFileSync(indexPath, "utf8");
const importLine = `import { ${varName} } from "./${slug}/product";\n`;
index = index.replace(/(import [^\n]+ from "\.\/[^"]+\/product";\n)(?![\s\S]*import [^\n]+ from "\.\/[^"]+\/product";)/, `$1${importLine}`);
index = index.replace(/export const PRODUCTS: Product\[\] = \[([^\]]*)\];/, (_, list: string) => `export const PRODUCTS: Product[] = [${list.trim()}, ${varName}];`);
writeFileSync(indexPath, index);

console.log(`作りました:
  lib/products/${slug}/product.ts
  app/api/${slug}/route.ts
  lib/products/index.ts に追加
次: product.ts の TODO と run を書き、npx tsx scripts/shop-test.ts で検査してください。`);
