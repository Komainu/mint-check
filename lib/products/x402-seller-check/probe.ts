/**
 * 相手の x402 エンドポイントに「支払いなし」で1回だけリクエストを送る。
 *
 * 安全のための決まり:
 *   - https のみ。ポートは 443 のみ。リダイレクトは追わない（行き先を報告するだけ）
 *   - 接続の直前に DNS の結果を検査し、内部・予約済みのアドレスには繋がない（SSRF 対策）
 *   - 待つのは最大 8 秒、読むのは最大 64KB
 *   - 支払いヘッダーは一切付けない（署名も支払いもしない）
 */
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

export type ProbeResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
  latencyMs: number;
};

export type Prober = (url: URL, method: "GET" | "POST") => Promise<ProbeResponse>;

const TIMEOUT_MS = 8000;
const MAX_BODY = 64 * 1024;

/** 内部・予約済み・ループバックなど、外から呼ばせてはいけないアドレスか */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map(Number);
    const [a, b] = p;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith("64:ff9b:") || x.startsWith("2001:db8");
  }
  return true;
}

/** 入力の URL を検査する。問題があれば英語の理由を返す */
export function validateTargetUrl(raw: string | null): { url: URL } | { error: string } {
  if (!raw) return { error: "url is required: the https URL of the paid endpoint." };
  if (raw.length > 2048) return { error: "url is too long (max 2048 characters)." };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { error: "url is not a valid absolute URL." };
  }
  if (u.protocol !== "https:") return { error: "Only https URLs are checked." };
  if (u.port && u.port !== "443") return { error: "Only the default https port (443) is checked." };
  if (u.username || u.password) return { error: "URLs with credentials are not checked." };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) return { error: "Private or reserved addresses are not checked." };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { error: "Private or reserved hosts are not checked." };
  }
  return { url: u };
}

/** 接続直前に DNS を引き、内部アドレスなら接続そのものを止める */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as { address: string; family: number }[];
    const bad = list.find(a => isBlockedAddress(a.address));
    if (bad || list.length === 0) {
      return callback(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 0);
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

/** 本番用: Node の https で1回だけ送る */
export const httpsProber: Prober = (url, method) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const body = method === "POST" ? "{}" : undefined;
    const req = httpsRequest(
      url,
      {
        method,
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": "x402-seller-check/0.1 (+https://mint-check.vercel.app)",
          accept: "application/json",
          ...(body ? { "content-type": "application/json", "content-length": String(body.length) } : {}),
        },
      },
      res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= MAX_BODY) chunks.push(c);
          else res.destroy();
        });
        const finish = () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") headers[k.toLowerCase()] = v;
            else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(", ");
          }
          resolve({
            status: res.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY),
            latencyMs: Date.now() - started,
          });
        };
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
