/** x402 Seller Check の有料API（GET・POST）。中身は lib/products/x402-seller-check/product.ts。 */
import { createPaidRoute } from "@/lib/shop/paid-route";
import { x402SellerCheck } from "@/lib/products/x402-seller-check/product";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const { GET, POST } = createPaidRoute(x402SellerCheck);
