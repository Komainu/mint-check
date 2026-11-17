/**
 * 商品1つ分の有料APIを作る。支払いが済んだ呼び出しだけ product.run まで届く。
 *   GET  /api/<slug>?key=value
 *   POST /api/<slug>   本文 {"key": "value"}（OpenSea などの JSON 入力向け）
 * 返す status が 400 以上なら課金されない。
 */
import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { sharedResourceServer } from "./payment";
import { buildRoutes } from "./catalog";
import type { Product, ProductInput } from "./types";

/** 商品が受け付ける入力の名前だけを、GET のクエリか POST の JSON 本文から読む */
export async function readInput(
  request: NextRequest,
  keys: string[],
): Promise<ProductInput | { error: string }> {
  const out: ProductInput = {};
  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      return { error: "Body must be JSON, for example {\"address\":\"0x...\"}." };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Body must be a JSON object." };
    const b = body as Record<string, unknown>;
    for (const k of keys) {
      const v = b[k];
      out[k] = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
    }
    return out;
  }
  for (const k of keys) out[k] = request.nextUrl.searchParams.get(k);
  return out;
}

type Handler = (request: NextRequest) => Promise<NextResponse>;

export function createPaidRoute(product: Product): { GET: Handler; POST: Handler } {
  const keys = Object.keys(product.bazaar.inputSchema.properties);

  async function handler(request: NextRequest): Promise<NextResponse> {
    const input = await readInput(request, keys);
    if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
    const result = await product.run(input);
    return NextResponse.json(result.body, { status: result.status });
  }

  // 初回の呼び出し時に組み立てる（ビルド時に外部へ接続しないため）
  let paid: Handler | null = null;
  async function entry(request: NextRequest): Promise<NextResponse> {
    if (!paid) {
      try {
        paid = withX402(handler, buildRoutes(product), sharedResourceServer()) as Handler;
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 500 });
      }
    }
    return paid(request);
  }

  return { GET: entry, POST: entry };
}
