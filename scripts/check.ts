/**
 * 支払いなしでチェック本体だけを試す。
 *   npm run check -- 0xコントラクトアドレス
 */
import { isValidAddress, makeClient, runMintCheck } from "../lib/checks";

const address = process.argv[2] ?? null;
if (!isValidAddress(address)) {
  console.error("使い方: npm run check -- 0xコントラクトアドレス");
  process.exit(1);
}

runMintCheck(address, makeClient(process.env.BASE_RPC_URL)).then(
  result => console.log(JSON.stringify(result, null, 2)),
  error => {
    console.error("失敗:", error);
    process.exit(1);
  },
);
