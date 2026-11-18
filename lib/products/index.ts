/**
 * 店に並んでいる商品の一覧。新しい商品はここに足す（scripts/new-product.ts が足し方を案内する）。
 */
import type { Product } from "@/lib/shop/types";
import { mintCheck } from "./mint-check/product";
import { x402SellerCheck } from "./x402-seller-check/product";

export const PRODUCTS: Product[] = [mintCheck, x402SellerCheck];

export function findProduct(slug: string): Product | undefined {
  return PRODUCTS.find(p => p.slug === slug);
}
