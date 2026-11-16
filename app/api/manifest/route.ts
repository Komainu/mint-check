/**
 * OpenSea（ERC-8257）用のマニフェストを返す。無料。
 * 公開URLは /.well-known/ai-tool/mint-check.json（next.config.ts で書き換え）。
 */
import { NextResponse } from "next/server";
import { buildManifest } from "@/lib/manifest";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(buildManifest(), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
