/**
 * 有料API: GET /api/mint-check?address=0x...&tokenId=1（tokenId は任意。ERC-1155 用）
 * 支払いが済んだ呼び出しだけここまで届く。エラー（400番台以上）のときは課金されない。
 */
import { NextRequest, NextResponse } from "next/server";
import { withX402 } from "@x402/next";
import { buildResourceServer, buildRouteConfig } from "@/lib/x402";
import { isValidAddress, makeClient, parseTokenId, runMintCheck } from "@/lib/checks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function handler(request: NextRequest): Promise<NextResponse> {
  const address = request.nextUrl.searchParams.get("address");
  if (!isValidAddress(address)) {
    return NextResponse.json(
      { error: "address is required: a 0x-prefixed 40-hex contract address on Base." },
      { status: 400 },
    );
  }
  const tokenId = parseTokenId(request.nextUrl.searchParams.get("tokenId"));
  if (tokenId === null) {
    return NextResponse.json({ error: "tokenId must be a non-negative decimal integer." }, { status: 400 });
  }
  try {
    const result = await runMintCheck(address, makeClient(process.env.BASE_RPC_URL), { tokenId });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Upstream RPC failed. You were not charged." }, { status: 502 });
  }
}

// 初回の呼び出し時に料金所を組み立てる（ビルド時に外部へ接続しないため）
type PaidHandler = (request: NextRequest) => Promise<NextResponse>;
let paid: PaidHandler | null = null;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!paid) {
    try {
      paid = withX402(handler, buildRouteConfig(), buildResourceServer()) as PaidHandler;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }
  return paid(request);
}
