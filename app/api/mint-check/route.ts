/**
 * 有料API。支払いが済んだ呼び出しだけ handler まで届く。エラー（400番台以上）のときは課金されない。
 *   GET  /api/mint-check?address=0x...&tokenId=1
 *   POST /api/mint-check   本文 {"address":"0x...","tokenId":"1"}（OpenSea などの JSON 入力向け）
 * tokenId は任意（ERC-1155 用）。
 */
import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { buildResourceServer, buildRoutes } from "@/lib/x402";
import { isValidAddress, makeClient, parseTokenId, runMintCheck } from "@/lib/checks";
import { readInput } from "@/lib/input";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function handler(request: NextRequest): Promise<NextResponse> {
  const input = await readInput(request);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  if (!isValidAddress(input.address)) {
    return NextResponse.json(
      { error: "address is required: a 0x-prefixed 40-hex contract address on Base." },
      { status: 400 },
    );
  }
  const tokenId = parseTokenId(input.tokenId);
  if (tokenId === null) {
    return NextResponse.json({ error: "tokenId must be a non-negative decimal integer." }, { status: 400 });
  }
  try {
    const result = await runMintCheck(input.address, makeClient(process.env.BASE_RPC_URL), { tokenId });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Upstream RPC failed. You were not charged." }, { status: 502 });
  }
}

// 初回の呼び出し時に料金所を組み立てる（ビルド時に外部へ接続しないため）
type PaidHandler = (request: NextRequest) => Promise<NextResponse>;
let paid: PaidHandler | null = null;

async function paidEntry(request: NextRequest): Promise<NextResponse> {
  if (!paid) {
    try {
      paid = withX402(handler, buildRoutes(), buildResourceServer()) as PaidHandler;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }
  return paid(request);
}

export const GET = paidEntry;
export const POST = paidEntry;
