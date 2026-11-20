/** /.well-known/x402（next.config の rewrite でここに来る）。互換用。無料。 */
import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { buildWellKnownX402 } from "@/lib/shop/discovery";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(buildWellKnownX402(PRODUCTS), {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
