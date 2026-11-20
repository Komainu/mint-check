/** Tokenized Stock Check の有料API（GET・POST）。中身は lib/products/tokenized-stock-check/product.ts。 */
import { createPaidRoute } from "@/lib/shop/paid-route";
import { tokenizedStockCheck } from "@/lib/products/tokenized-stock-check/product";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const { GET, POST } = createPaidRoute(tokenizedStockCheck);
