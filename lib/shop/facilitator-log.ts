/**
 * ファシリテーターとのやり取りが失敗したときだけ、Vercel のログに詳細を書き出す。
 * 署名や認証ヘッダーは書き出さない（長さだけ残す）。
 */

const FACILITATOR_HOSTS = ["api.cdp.coinbase.com", "x402.org"];
let installed = false;

/** 中身の値を伏せて、形（キー・型・長さ）だけを残す */
function shape(value: unknown, key = ""): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (/signature/i.test(key)) return `<signature ${value.length} chars>`;
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return value; // アドレスはそのまま
    return value.length > 120 ? `<string ${value.length} chars>` : value;
  }
  if (Array.isArray(value)) return value.map(v => shape(v, key));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shape(v, k)]));
  }
  return value;
}

export function installFacilitatorLogging() {
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isFacilitator = FACILITATOR_HOSTS.some(h => url.includes(h));
    const response = await originalFetch(input, init);
    if (!isFacilitator || response.ok) return response;

    let requestShape: unknown = "<unreadable>";
    try {
      if (typeof init?.body === "string") requestShape = shape(JSON.parse(init.body));
    } catch {
      /* 読めなければ伏せたまま */
    }
    const bodyText = await response.clone().text().catch(() => "<unreadable>");
    console.error(
      "[facilitator-error]",
      JSON.stringify({ url, status: response.status, response: bodyText.slice(0, 8000), request: requestShape }),
    );
    return response;
  };
}
