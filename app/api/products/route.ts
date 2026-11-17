/**
 * 店の商品一覧（無料）。エージェントや週次チェックインが、どんな商品があるかを知るために使う。
 */
import { NextResponse } from "next/server";
import { PRODUCTS } from "@/lib/products";
import { PUBLIC_ORIGIN, manifestPath, priceToBaseUnits } from "@/lib/shop/catalog";
import { productPath } from "@/lib/shop/types";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    shop: "AI agent shop (x402)",
    products: PRODUCTS.map(p => ({
      name: p.serviceName,
      slug: p.slug,
      description: p.description,
      tags: p.tags,
      endpoint: `${PUBLIC_ORIGIN}${productPath(p)}`,
      priceUsdcBaseUnits: priceToBaseUnits(p.price()),
      manifest: `${PUBLIC_ORIGIN}${manifestPath(p)}`,
    })),
  });
}
