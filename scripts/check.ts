/**
 * 支払いなしでチェック本体だけを試す。
 *   npm run check -- 0xコントラクトアドレス [トークン番号]
 */
import { isValidAddress, makeClient, parseTokenId, runMintCheck } from "../lib/checks";

const address = process.argv[2] ?? null;
if (!isValidAddress(address)) {
  console.error("使い方: npm run check -- 0xコントラクトアドレス [トークン番号]");
  process.exit(1);
}
const tokenId = parseTokenId(process.argv[3]);
if (tokenId === null) {
  console.error("トークン番号は0以上の整数で指定してください。");
  process.exit(1);
}

runMintCheck(address, makeClient(process.env.BASE_RPC_URL), { tokenId }).then(
  result => console.log(JSON.stringify(result, null, 2)),
  error => {
    console.error("失敗:", error);
    process.exit(1);
  },
);
