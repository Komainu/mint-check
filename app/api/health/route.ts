/**
 * 店の健康状態（無料）。RPC がどこにつながっているかを、鍵を出さずに確かめるための窓口。
 * 返すのは RPC のホスト名だけ（Alchemy なら base-mainnet.g.alchemy.com）。URL の残り（鍵）は返さない。
 */
import { NextResponse } from "next/server";
import { makeClient } from "@/lib/products/mint-check/checks";
import pkg from "@/package.json";

export const dynamic = "force-dynamic";

function hostOnly(url: string | undefined): string {
  if (!url) return "public default (no BASE_RPC_URL)";
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid BASE_RPC_URL";
  }
}

export async function GET(): Promise<NextResponse> {
  const started = Date.now();
  let blockNumber: string | null = null;
  try {
    blockNumber = (await makeClient(process.env.BASE_RPC_URL).getBlockNumber()).toString();
  } catch {
    blockNumber = null;
  }
  return NextResponse.json(
    {
      ok: blockNumber !== null,
      version: pkg.version,
      rpc: { base: hostOnly(process.env.BASE_RPC_URL), blockNumber, latencyMs: Date.now() - started },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
