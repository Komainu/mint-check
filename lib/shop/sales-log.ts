/**
 * 売上の記録: 決済が成立するたびに、Notion の「売上記録」に1行書く。
 *
 * - 客への返事を遅らせないよう、書き込みは返事のあと（Next.js の after）に行う。
 * - 書き込みに失敗しても、販売そのものは成功のまま。失敗は Vercel のログに [sales-log] として残す。
 * - NOTION_TOKEN が未設定なら何もしない（記録なしで販売は続く）。
 *
 * 環境変数:
 *   NOTION_TOKEN                  Notion の内部インテグレーションのキー（必須。チャットや GitHub に載せない）
 *   NOTION_SALES_DATA_SOURCE_ID   売上記録の data source ID（未設定なら下の既定値）
 *   OWNER_ADDRESS                 運営者自身の購入アドレス（区分を「運営者」にする。未設定なら既定値）
 */
import { after } from "next/server";
import type { SettleResultContext } from "@x402/core/server";
import { PRODUCTS } from "@/lib/products";
import { productPath } from "./types";

const DEFAULT_SALES_DATA_SOURCE_ID = "41bd7043-0798-81bb-92cc-000b06f6cd5f";
const DEFAULT_OWNER_ADDRESS = "0xe0f8476aee274ca1dd3176949d5c277350a96238";
const NOTION_VERSION = "2025-09-03";

const NETWORK_NAMES: Record<string, { name: string; explorer: string }> = {
  "eip155:8453": { name: "Base", explorer: "https://basescan.org/tx/" },
  "eip155:84532": { name: "Base Sepolia", explorer: "https://sepolia.basescan.org/tx/" },
};

export type Sale = {
  productName: string;
  at: Date;
  payer: string;
  amountUsdc: number;
  transaction: string;
  network: string;
};

/** 決済の結果から、記録する売上の中身を作る。記録しないものは null */
export function saleFromSettlement(ctx: Pick<SettleResultContext, "result" | "requirements" | "paymentPayload">, now = new Date()): Sale | null {
  const { result, requirements, paymentPayload } = ctx;
  if (!result.success || !result.transaction) return null;

  const url = paymentPayload.resource?.url;
  let path = "";
  try {
    path = url ? new URL(url).pathname : "";
  } catch {
    path = "";
  }
  const product = PRODUCTS.find(p => productPath(p) === path);
  const atomic = result.amount ?? requirements.amount;
  const amountUsdc = Number(atomic) / 1_000_000;

  return {
    productName: product?.serviceName ?? (path || "不明"),
    at: now,
    payer: (result.payer ?? "").toLowerCase(),
    amountUsdc: Number.isFinite(amountUsdc) ? amountUsdc : 0,
    transaction: result.transaction,
    network: result.network ?? requirements.network,
  };
}

function jst(d: Date) {
  const t = new Date(d.getTime() + 9 * 3600_000).toISOString(); // 2026-11-16T21:02:24.000Z の形
  return { label: `${t.slice(0, 10)} ${t.slice(11, 16)}`, iso: `${t.slice(0, 19)}+09:00` };
}

/** Notion の API に送る中身 */
export function notionPageBody(sale: Sale, dataSourceId: string, ownerAddress: string) {
  const when = jst(sale.at);
  const net = NETWORK_NAMES[sale.network];
  const isOwner = sale.payer !== "" && sale.payer === ownerAddress.toLowerCase();
  const text = (content: string) => [{ type: "text", text: { content } }];
  return {
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: {
      記録: { title: text(`${when.label} ${sale.productName}`) },
      商品: { select: { name: sale.productName } },
      日時: { date: { start: when.iso } },
      区分: { select: { name: isOwner ? "運営者" : "外部客" } },
      購入者: { rich_text: text(sale.payer || "不明") },
      "金額(USDC)": { number: sale.amountUsdc },
      取引: { url: net ? net.explorer + sale.transaction : null },
      ネットワーク: { select: { name: net?.name ?? sale.network } },
      記録元: { select: { name: "API自動" } },
    },
  };
}

/** 1件を Notion に書く。失敗しても例外を投げず、ログに残す */
export async function writeSale(sale: Sale, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) return false;
  const dataSourceId = process.env.NOTION_SALES_DATA_SOURCE_ID?.trim() || DEFAULT_SALES_DATA_SOURCE_ID;
  const owner = process.env.OWNER_ADDRESS?.trim() || DEFAULT_OWNER_ADDRESS;
  try {
    const res = await fetchImpl("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(notionPageBody(sale, dataSourceId, owner)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 500);
      console.error("[sales-log]", JSON.stringify({ status: res.status, detail, transaction: sale.transaction }));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[sales-log]", JSON.stringify({ error: String(e), transaction: sale.transaction }));
    return false;
  }
}

/** 料金所に「決済成立のあとで売上を記録する」処理を付ける */
export function attachSalesLog(server: { onAfterSettle: (hook: (ctx: SettleResultContext) => Promise<void>) => unknown }) {
  server.onAfterSettle(async ctx => {
    try {
      const sale = saleFromSettlement(ctx);
      if (!sale || !process.env.NOTION_TOKEN) return;
      try {
        // 客への返事を送ったあとで書く
        after(() => writeSale(sale).then(() => undefined));
      } catch {
        // リクエストの外（テストなど）では after が使えないので、待たずに書く
        void writeSale(sale);
      }
    } catch (e) {
      console.error("[sales-log]", JSON.stringify({ error: String(e) }));
    }
  });
}
