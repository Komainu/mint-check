/**
 * Tokenized Stock Check のテスト: npx tsx scripts/stock-check-test.ts
 * 外には接続しない。チェーンの答えは、2026-11-20 に NVDAc と Dinari AAPL で実際に読んだ値を元にした偽物。
 */
import {
  createPublicClient,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  type Hex,
  type PublicClient,
} from "viem";
import { base } from "viem/chains";
import { runStockCheck, usMarketSession, PROBE_ADDRESS } from "../lib/products/tokenized-stock-check/checks";
import { tokenizedStockCheck } from "../lib/products/tokenized-stock-check/product";

let failed = 0;
const expect = (label: string, ok: boolean) => {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
};

const abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function pausedFeatures() view returns (uint8[])",
  "function supplyCap() view returns (uint256)",
  "function uiMultiplier() view returns (uint256)",
  "function TRANSFER_SENDER_POLICY() view returns (bytes32)",
  "function TRANSFER_RECEIVER_POLICY() view returns (bytes32)",
  "function SEIZE_EXEMPT_POLICY() view returns (bytes32)",
  "function policyId(bytes32) view returns (uint64)",
  "function paused() view returns (bool)",
  "function transferRestrictor() view returns (address)",
  "function balancePerShare() view returns (uint256)",
  "function implementation() view returns (address)",
  "function owner() view returns (address)",
  "function isBlacklisted(address) view returns (bool)",
  "function policyAdmin(uint64) view returns (address)",
  "function isAuthorized(uint64,address) view returns (bool)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);
const call = (functionName: string, args: unknown[] = []) =>
  encodeFunctionData({ abi, functionName, args } as never).toLowerCase();
const ret = (types: string[], values: unknown[]) =>
  encodeAbiParameters(types.map(type => ({ type })), values as never);

const NVDAC = "0xb20000000000000000000078ee7ce2fE4908108C".toLowerCase();
const PAUSED_B20 = "0xb200000000000000000000aaaaaaaaaaaaaaaaaa";
const DINARI = "0x41f7a63713e76c0ab800be03bae9f17b8a356348";
const BEACON = "0x6aa1bda7e764bc62589e64f371a4022b80b3c72a";
const RESTRICTOR = "0xe1b2feede3ffe7e63a89a669a08688951c94611e";
const REGISTRY = "0x8453000000000000000000000000000000000002";
const FEED_NVDA = "0x04689a41629776563e6822f76f2e57d148d28513";
const EOA = "0x2222222222222222222222222222222222222222";
const SAFE = "0x4444444444444444444444444444444444444444";
const OTHER = "0x5555555555555555555555555555555555555555";
const S_SEND = ("0x" + "11".repeat(32)) as Hex;
const S_RECV = ("0x" + "22".repeat(32)) as Hex;
const S_SEIZE = ("0x" + "33".repeat(32)) as Hex;
const U128 = (1n << 128n) - 1n;

// 本物の Dinari のコード（ビーコン型プロキシ）の先頭部分
const DINARI_CODE = ("0x608060405261000c61000e565b005b61001e610019610020565b6100b3565b565b5f7f000000000000000000000000" +
  BEACON.slice(2) +
  "73ffffffffffffffffffffffffffffffffffffffff16635c60da1b6040518163ffffffff1660e01b81526004") as Hex;

const NOW_OPEN = new Date("2026-11-19T15:00:00Z"); // NY 10:00 木曜
const NOW_CLOSED = new Date("2026-11-19T22:30:00Z"); // NY 17:30 木曜
const NOW_WEEKEND = new Date("2026-11-21T15:00:00Z"); // 土曜
const sec = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));
let feedUpdatedAt = sec(NOW_OPEN) - 3600n;

const world: Record<string, { code: Hex; calls: () => Record<string, Hex> }> = {
  [NVDAC]: {
    code: "0xef",
    calls: () => ({
      [call("name")]: ret(["string"], ["NVIDIA"]),
      [call("symbol")]: ret(["string"], ["NVDAc"]),
      [call("decimals")]: ret(["uint8"], [18]),
      [call("totalSupply")]: ret(["uint256"], [47000n * 10n ** 18n]),
      [call("pausedFeatures")]: ret(["uint8[]"], [[]]),
      [call("supplyCap")]: ret(["uint256"], [U128]),
      [call("uiMultiplier")]: ret(["uint256"], [1001100000000000000n]),
      [call("TRANSFER_SENDER_POLICY")]: ret(["bytes32"], [S_SEND]),
      [call("TRANSFER_RECEIVER_POLICY")]: ret(["bytes32"], [S_RECV]),
      [call("SEIZE_EXEMPT_POLICY")]: ret(["bytes32"], [S_SEIZE]),
      [call("policyId", [S_SEND])]: ret(["uint64"], [5n]),
      [call("policyId", [S_RECV])]: ret(["uint64"], [0n]),
      [call("policyId", [S_SEIZE])]: ret(["uint64"], [129n]),
    }),
  },
  [PAUSED_B20]: {
    code: "0xef",
    calls: () => ({
      [call("symbol")]: ret(["string"], ["XYZc"]),
      [call("decimals")]: ret(["uint8"], [18]),
      [call("pausedFeatures")]: ret(["uint8[]"], [[0, 1]]),
      [call("supplyCap")]: ret(["uint256"], [1000n * 10n ** 18n]),
      [call("TRANSFER_SENDER_POLICY")]: ret(["bytes32"], [S_SEND]),
      [call("TRANSFER_RECEIVER_POLICY")]: ret(["bytes32"], [S_RECV]),
      [call("SEIZE_EXEMPT_POLICY")]: ret(["bytes32"], [S_SEIZE]),
      [call("policyId", [S_SEND])]: ret(["uint64"], [7n]),
      [call("policyId", [S_RECV])]: ret(["uint64"], [0n]),
      [call("policyId", [S_SEIZE])]: ret(["uint64"], [0n]),
    }),
  },
  [REGISTRY]: {
    code: "0xef",
    calls: () => ({
      [call("policyAdmin", [5n])]: ret(["address"], [EOA]),
      [call("isAuthorized", [5n, PROBE_ADDRESS])]: ret(["bool"], [true]),
      [call("isAuthorized", [0n, PROBE_ADDRESS])]: ret(["bool"], [true]),
      [call("policyAdmin", [129n])]: ret(["address"], [SAFE]),
      [call("isAuthorized", [129n, PROBE_ADDRESS])]: ret(["bool"], [true]),
      [call("policyAdmin", [7n])]: ret(["address"], [SAFE]),
      [call("isAuthorized", [7n, PROBE_ADDRESS])]: ret(["bool"], [false]),
    }),
  },
  [FEED_NVDA]: {
    code: "0x6080",
    calls: () => ({
      [call("description")]: ret(["string"], ["Coinbase NVDA"]),
      [call("latestRoundData")]: ret(["uint80", "int256", "uint256", "uint256", "uint80"], [1n, 14354000483n, feedUpdatedAt, feedUpdatedAt, 1n]),
    }),
  },
  [DINARI]: {
    code: DINARI_CODE,
    calls: () => ({
      [call("name")]: ret(["string"], ["Apple Inc. - Dinari"]),
      [call("symbol")]: ret(["string"], ["AAPL"]),
      [call("decimals")]: ret(["uint8"], [18]),
      [call("totalSupply")]: ret(["uint256"], [134n * 10n ** 18n]),
      [call("transferRestrictor")]: ret(["address"], [RESTRICTOR]),
      [call("balancePerShare")]: ret(["uint256"], [10n ** 18n]),
      [call("paused")]: ret(["bool"], [false]),
    }),
  },
  [BEACON]: {
    code: "0x6080",
    calls: () => ({
      [call("implementation")]: ret(["address"], [OTHER]),
      [call("owner")]: ret(["address"], [EOA]),
    }),
  },
  [RESTRICTOR]: {
    code: "0x6080",
    calls: () => ({ [call("isBlacklisted", [PROBE_ADDRESS])]: ret(["bool"], [false]) }),
  },
  [SAFE]: { code: "0x6080", calls: () => ({}) },
  [OTHER]: { code: "0x6080", calls: () => ({ [call("name")]: ret(["string"], ["Some Token"]) }) },
};

const client = createPublicClient({
  chain: base,
  transport: custom(
    {
      async request({ method, params }: { method: string; params: any[] }) {
        if (method === "eth_getCode") return world[params[0].toLowerCase()]?.code ?? "0x";
        if (method === "eth_call") {
          const answer = world[params[0].to.toLowerCase()]?.calls()[params[0].data.toLowerCase()];
          if (answer) return answer;
          throw new Error("execution reverted");
        }
        if (method === "eth_chainId") return "0x2105";
        throw new Error("unsupported " + method);
      },
    },
    { retryCount: 0 },
  ),
}) as PublicClient;

const has = (r: any, code: string) => r.flags.some((f: any) => f.code === code);

async function main() {
  console.log("## 1. 米国市場の時間");
  const m1 = usMarketSession(NOW_OPEN);
  expect("木曜 NY 10:00 は通常取引中", m1.open === true && m1.session === "regular" && m1.feedWindowOpen === true);
  const m2 = usMarketSession(NOW_CLOSED);
  expect("木曜 NY 17:30 は時間外（フィードは動く）", m2.open === false && m2.session === "extended" && m2.feedWindowOpen === true);
  const m3 = usMarketSession(NOW_WEEKEND);
  expect("土曜は weekend（フィード停止）", m3.session === "weekend" && m3.feedWindowOpen === false);
  expect("NY 9:29 は時間外", usMarketSession(new Date("2026-11-19T14:29:00Z")).session === "extended");
  expect("夏時間（7月）の NY 9:30 は通常取引", usMarketSession(new Date("2026-07-15T13:30:00Z")).open === true);
  expect("金曜 NY 19:59 はフィードが動く", usMarketSession(new Date("2026-11-21T00:59:00Z")).feedWindowOpen === true);
  expect("金曜 NY 20:00 でフィード停止", usMarketSession(new Date("2026-11-21T01:00:00Z")).feedWindowOpen === false);
  expect("日曜 NY 19:59 はまだ停止", usMarketSession(new Date("2026-11-23T00:59:00Z")).feedWindowOpen === false);
  expect("日曜 NY 20:00 でフィード再開", usMarketSession(new Date("2026-11-23T01:00:00Z")).feedWindowOpen === true && usMarketSession(new Date("2026-11-23T01:00:00Z")).session === "extended");
  expect("月曜 NY 3:00（夜間）はフィードが動く", usMarketSession(new Date("2026-11-23T08:00:00Z")).feedWindowOpen === true);

  console.log("\n## 2. Coinbase（B20）NVDAc");
  const a: any = await runStockCheck(NVDAC, { client, now: () => NOW_OPEN });
  expect("発行元は coinbase_b20", a.issuer === "coinbase_b20");
  expect("名前と銘柄", a.token.name === "NVIDIA" && a.token.symbol === "NVDAc" && a.token.totalSupply === "47000");
  expect("止まっている機能なし", Array.isArray(a.status.pausedFeatures) && a.status.pausedFeatures.length === 0);
  expect("上限なし", a.controls.supplyCap === "uncapped");
  expect("配当の倍率 1.0011", Math.abs(a.controls.dividendMultiplier - 1.0011) < 1e-9);
  expect("送金のブロックリスト（policy 5、普段は誰でも送れる）", a.controls.transferSenderPolicy.policyId === "5" && a.controls.transferSenderPolicy.openByDefault === true);
  expect("ブロックリストの管理者は単独の鍵", a.controls.transferSenderPolicy.adminKind === "single_key" && has(a, "BLOCKLIST_ADMIN_SINGLE_KEY"));
  expect("ISSUER_CAN_BLOCK_ADDRESSES", has(a, "ISSUER_CAN_BLOCK_ADDRESSES"));
  expect("受け取り側は制限なし（policy 0）", a.controls.transferReceiverPolicy.policyId === "0");
  expect("没収が設定済み（policy 129、管理者はコントラクト）", a.controls.seizePolicy.policyId === "129" && a.controls.seizePolicy.adminKind === "contract" && has(a, "SEIZE_CONFIGURED"));
  expect("Chainlink 価格 143.54", Math.abs((a.price?.answerUsd ?? 0) - 143.54) < 0.01 && a.price.ageSeconds === 3600);
  expect("開場中で1時間前の更新は古くない", !has(a, "PRICE_FEED_STALE"));
  expect("開場中は週末停止の注意なし", !has(a, "PRICE_FEED_FROZEN_WEEKEND") && a.market.open === true);
  expect("役割は列挙できないと書く", a.notMeasured.some((n: any) => n.item === "controls.roles"));

  feedUpdatedAt = sec(NOW_OPEN) - 3n * 86400n;
  const stale: any = await runStockCheck(NVDAC, { client, now: () => NOW_OPEN });
  expect("開場中に3日前の価格は PRICE_FEED_STALE", has(stale, "PRICE_FEED_STALE"));
  const weekend: any = await runStockCheck(NVDAC, { client, now: () => NOW_WEEKEND });
  expect("週末は古くても STALE にしない", !has(weekend, "PRICE_FEED_STALE") && has(weekend, "PRICE_FEED_FROZEN_WEEKEND"));
  const extendedStale: any = await runStockCheck(NVDAC, { client, now: () => NOW_CLOSED });
  expect("平日の時間外でも3日前の価格は STALE", has(extendedStale, "PRICE_FEED_STALE") && !has(extendedStale, "PRICE_FEED_FROZEN_WEEKEND"));
  feedUpdatedAt = sec(NOW_OPEN) - 3600n;

  const flagCount = (r: any, code: string) => r.flags.filter((f: any) => f.code === code).length;
  {
    // 本番の NVDAc と同じく、受け取る側も同じ policy 5 の場合
    const orig = world[NVDAC].calls;
    world[NVDAC].calls = () => ({ ...orig(), [call("policyId", [S_RECV])]: ret(["uint64"], [5n]) });
    const same: any = await runStockCheck(NVDAC, { client, now: () => NOW_OPEN });
    world[NVDAC].calls = orig;
    expect("同じポリシーなら注意は1回", flagCount(same, "ISSUER_CAN_BLOCK_ADDRESSES") === 1 && flagCount(same, "BLOCKLIST_ADMIN_SINGLE_KEY") === 1);
    expect("注意に両方の範囲を書く", same.flags.find((f: any) => f.code === "ISSUER_CAN_BLOCK_ADDRESSES").note.includes("TRANSFER_SENDER_POLICY and TRANSFER_RECEIVER_POLICY"));
  }

  console.log("\n## 3. 止まっている B20（許可リスト型）");
  const p: any = await runStockCheck(PAUSED_B20, { client, now: () => NOW_CLOSED });
  expect("TRANSFER と MINT が停止中", p.status.pausedFeatures.join() === "TRANSFER,MINT" && has(p, "TRANSFER_PAUSED") && has(p, "MINT_PAUSED"));
  expect("許可リスト型を見分ける", p.controls.transferSenderPolicy.openByDefault === false && has(p, "TRANSFERS_ALLOWLIST_ONLY"));
  expect("上限 1000", p.controls.supplyCap === "1000");
  expect("没収なし", !has(p, "SEIZE_CONFIGURED"));
  expect("知らない銘柄の価格は測れないと書く", p.price === null && p.notMeasured.some((n: any) => n.item === "price"));
  expect("平日の時間外は週末停止の注意を出さない", !has(p, "PRICE_FEED_FROZEN_WEEKEND") && p.market.session === "extended");

  console.log("\n## 4. Dinari AAPL");
  const d: any = await runStockCheck(DINARI, { client, now: () => NOW_OPEN });
  expect("発行元は dinari", d.issuer === "dinari" && d.token.name === "Apple Inc. - Dinari");
  expect("止まっていない", d.status.paused === false && !has(d, "TRANSFER_PAUSED"));
  expect("1トークン=1株", d.controls.sharesPerToken === 1);
  expect("ビーコンを見つける", d.controls.upgrade?.beacon?.toLowerCase() === BEACON);
  expect("ビーコンの持ち主は単独の鍵", d.controls.upgrade.beaconOwnerKind === "single_key" && has(d, "UPGRADE_KEY_SINGLE") && has(d, "UPGRADEABLE_BY_BEACON"));
  expect("ブラックリストあり", d.controls.transferRestrictor?.hasBlacklist === true && has(d, "ISSUER_CAN_BLOCK_ADDRESSES"));
  expect("オンチェーン価格なしと書く", d.price === null && d.notMeasured.some((n: any) => n.item === "price"));

  console.log("\n## 5. 対応外");
  const u: any = await runStockCheck(OTHER, { client, now: () => NOW_OPEN });
  expect("知らない発行元は unknown", u.issuer === "unknown" && u.notMeasured.some((n: any) => n.item === "issuer"));
  const e: any = await runStockCheck(EOA, { client, now: () => NOW_OPEN });
  expect("コードなしは NOT_A_CONTRACT", e.issuer === "unknown" && has(e, "NOT_A_CONTRACT"));

  console.log("\n## 6. 商品の入口");
  expect("不正なアドレスは 400", (await tokenizedStockCheck.run({ address: "0x123" })).status === 400);
  expect("説明文は 500 文字以内", tokenizedStockCheck.description.length <= 500);

  console.log(failed ? `\n${failed} 件失敗` : "\nすべて通過");
  process.exit(failed ? 1 : 0);
}
void main();
