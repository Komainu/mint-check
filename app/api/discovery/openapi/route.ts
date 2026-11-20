/** /openapi.json（next.config の rewrite でここに来る）。無料。 */
import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { buildOpenApi } from "@/lib/shop/discovery";
import pkg from "@/package.json";

export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(buildOpenApi(PRODUCTS, pkg.version), {
    headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
