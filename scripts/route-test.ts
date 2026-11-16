/**
 * 支払いなしで呼ばれたときの402応答に、表示名・タグ・パスが正しく載るかを確かめる。
 * 本物のファシリテーターには接続せず、代役を使う: npx tsx scripts/route-test.ts
 */
import { x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { buildRoutes, ROUTE_PATH, SERVICE_NAME, SERVICE_TAGS } from "../lib/x402";

process.env.PAY_TO = "0xCBD946D0Dc0AD404939f5868D8d6EFEdaDA0F7e3";
const network = "eip155:84532" as const;

const warnings: string[] = [];
const origWarn = console.warn;
console.warn = (...a: unknown[]) => warnings.push(a.join(" "));

const fakeFacilitator = {
  async getSupported() {
    return { kinds: [{ x402Version: 2, scheme: "exact", network }], extensions: [], signers: {} };
  },
  async verify() { throw new Error("not used"); },
  async settle() { throw new Error("not used"); },
};

let failed = 0;
const expect = (label: string, ok: boolean) => {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
};

(async () => {
  const server = new x402ResourceServer(fakeFacilitator as never).register(network, new ExactEvmScheme());
  server.registerExtension(bazaarResourceServerExtension);
  const http = new x402HTTPResourceServer(server, buildRoutes());
  await http.initialize();

  const url = `https://mint-check.example${ROUTE_PATH}?address=0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83`;
  const headers: Record<string, string> = { accept: "application/json" };
  const adapter = {
    getHeader: (n: string) => headers[n.toLowerCase()],
    getMethod: () => "GET",
    getPath: () => ROUTE_PATH,
    getUrl: () => url,
    getAcceptHeader: () => "application/json",
    getUserAgent: () => "route-test",
    getQueryParams: () => ({ address: "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83" }),
    getQueryParam: (n: string) => (n === "address" ? "0xBa5e05cb26b78eDa3A2f8e3b3814726305dcAc83" : undefined),
    getBody: async () => undefined,
  };
  const result = (await http.processHTTPRequest({ adapter: adapter as never, path: ROUTE_PATH, method: "GET" })) as {
    type: string;
    response?: { status: number; headers: Record<string, string> };
  };
  console.warn = origWarn;

  expect("支払いなしで402を返す", result.type === "payment-error" && result.response?.status === 402);
  const header = result.response?.headers["PAYMENT-REQUIRED"] ?? result.response?.headers["payment-required"];
  const body = header ? JSON.parse(Buffer.from(header, "base64").toString("utf8")) : {};
  const resource = body.resource ?? {};
  expect(`表示名が載る（${resource.serviceName}）`, resource.serviceName === SERVICE_NAME);
  expect(`タグが載る（${(resource.tags ?? []).join(", ")}）`, JSON.stringify(resource.tags) === JSON.stringify(SERVICE_TAGS));
  expect("説明文が載る", typeof resource.description === "string" && resource.description.length <= 500);
  expect("価格は0.02 USDC", body.accepts?.[0]?.amount === "20000");
  expect("Bazaar用の情報が載る", !!body.extensions?.bazaar);
  expect("ワイルドカードの警告が出ない", !warnings.some(w => w.includes("Wildcard")));
  if (warnings.length) console.log("（その他の警告）\n" + warnings.join("\n"));

  console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
  if (failed) process.exitCode = 1;
})();
