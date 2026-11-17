/**
 * 1号商品 Mint Check の有料API（GET・POST）。中身は lib/products/mint-check/product.ts。
 * 新しい商品も、このファイルと同じ3行で足せる（フォルダ名＝商品の slug）。
 */
import { createPaidRoute } from "@/lib/shop/paid-route";
import { mintCheck } from "@/lib/products/mint-check/product";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const { GET, POST } = createPaidRoute(mintCheck);
