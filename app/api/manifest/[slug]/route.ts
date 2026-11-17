/**
 * OpenSea（ERC-8257）用のマニフェストを返す。無料。
 * 公開URLは /.well-known/ai-tool/<slug>.json（next.config.ts で書き換え）。
 */
import { NextResponse } from "next/server";
import { buildManifest } from "@/lib/shop/catalog";
import { findProduct } from "@/lib/products";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const product = findProduct(slug);
  if (!product) return NextResponse.json({ error: "Unknown tool." }, { status: 404 });
  try {
    return NextResponse.json(buildManifest(product), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
