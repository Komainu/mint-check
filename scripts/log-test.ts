/** 失敗時のログに署名が出ないことを確かめる: npx tsx scripts/log-test.ts */
import { installFacilitatorLogging } from "../lib/shop/facilitator-log";

const logs: string[] = [];
console.error = (...a: unknown[]) => logs.push(a.join(" "));
globalThis.fetch = (async () => new Response('{"errorMessage":"bad payload"}', { status: 400 })) as typeof fetch;
installFacilitatorLogging();

(async () => {
  const sig = "0x" + "ab".repeat(400);
  await fetch("https://api.cdp.coinbase.com/platform/v2/x402/verify", {
    method: "POST",
    body: JSON.stringify({ paymentPayload: { payload: { signature: sig, authorization: { from: "0xCBD946D0Dc0AD404939f5868D8d6EFEdaDA0F7e3" } } } }),
  });
  await fetch("https://example.com/other", { method: "POST", body: "{}" });
  const out = logs.join("\n");
  const checks: [string, boolean][] = [
    ["失敗時に1件だけ記録", logs.length === 1],
    ["応答本文を含む", out.includes("bad payload")],
    ["署名そのものは含まない", !out.includes("abab")],
    ["署名の長さは残す", out.includes("<signature 802 chars>")],
    ["アドレスは残す", out.includes("0xCBD946D0Dc0AD404939f5868D8d6EFEdaDA0F7e3")],
  ];
  for (const [l, ok] of checks) process.stdout.write((ok ? "OK  " : "NG  ") + l + "\n");
  if (checks.some(c => !c[1])) process.exitCode = 1;
})();
