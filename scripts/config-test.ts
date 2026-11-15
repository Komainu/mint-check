/** 環境変数の組み合わせごとに、料金所の設定が正しく選ばれるかを確かめる: npx tsx scripts/config-test.ts */
import { getPaymentSettings } from "../lib/x402";

const PAY = "0xCBD946D0Dc0AD404939f5868D8d6EFEdaDA0F7e3";
let failed = 0;
function run(label: string, env: Record<string, string | undefined>, check: (r: unknown, e?: Error) => boolean) {
  const saved = { ...process.env };
  for (const k of ["PAY_TO", "X402_NETWORK", "FACILITATOR_URL", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET"]) delete process.env[k];
  Object.assign(process.env, env);
  let result: unknown, error: Error | undefined;
  try { result = getPaymentSettings(); } catch (e) { error = e as Error; }
  process.env = saved;
  const ok = check(result, error);
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
}
const f = (r: unknown) => (r as { facilitator: { kind: string } }).facilitator.kind;

run("練習用・キーなし → 練習用ファシリテーター", { PAY_TO: PAY }, r => f(r) === "url");
run("練習用・キーあり → CDP", { PAY_TO: PAY, CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s" }, r => f(r) === "cdp");
run("本番・キーあり → CDP", { PAY_TO: PAY, X402_NETWORK: "eip155:8453", CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s" }, r => f(r) === "cdp");
run("本番・キーなし → エラー", { PAY_TO: PAY, X402_NETWORK: "eip155:8453" }, (_, e) => !!e && /本番/.test(e.message));
run("キーが片方だけ → エラー", { PAY_TO: PAY, CDP_API_KEY_ID: "id" }, (_, e) => !!e && /両方/.test(e.message));
run("PAY_TO なし → エラー", {}, (_, e) => !!e && /PAY_TO/.test(e.message));

console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
if (failed) process.exitCode = 1;
