/** 有料APIの入力を読む。GET はクエリ、POST は JSON 本文 */
import type { NextRequest } from "next/server";

type Input = { address: string | null; tokenId: string | null };

/** GET はクエリ、POST は JSON 本文から入力を読む */
export async function readInput(request: NextRequest): Promise<Input | { error: string }> {
  if (request.method === "POST") {
    let body: unknown;
    try {
      body = await request.clone().json();
    } catch {
      return { error: "Body must be JSON: {\"address\":\"0x...\",\"tokenId\":\"1\"}." };
    }
    if (!body || typeof body !== "object") return { error: "Body must be a JSON object." };
    const b = body as Record<string, unknown>;
    const tokenId = b.tokenId;
    return {
      address: typeof b.address === "string" ? b.address : null,
      tokenId: typeof tokenId === "string" ? tokenId : typeof tokenId === "number" ? String(tokenId) : null,
    };
  }
  return {
    address: request.nextUrl.searchParams.get("address"),
    tokenId: request.nextUrl.searchParams.get("tokenId"),
  };
}

