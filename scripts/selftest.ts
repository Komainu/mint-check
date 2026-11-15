/** 通信なしでチェック本体を確かめる簡易テスト: npx tsx scripts/selftest.ts */
import { createPublicClient, custom, encodeAbiParameters, toFunctionSelector, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";
import { hasSelector, minimalProxyTarget, parseTokenId, runMintCheck } from "../lib/checks";

const NFT721 = "0x1111111111111111111111111111111111111111";
const EOA = "0x2222222222222222222222222222222222222222";
const NFT1155 = "0x3333333333333333333333333333333333333333";
const SAFE = "0x4444444444444444444444444444444444444444";
const NFT_OTHER_OWNER = "0x5555555555555555555555555555555555555555";
const PLAIN_CONTRACT = "0x6666666666666666666666666666666666666666";

const sel = (s: string) => toFunctionSelector(s).slice(2);
const fakeCode = (sigs: string[]) => ("0x6080" + sigs.map(s => "63" + sel(s)).join("")) as Hex;
const bool = (v: boolean) => encodeAbiParameters([{ type: "bool" }], [v]);
const uint = (v: bigint) => encodeAbiParameters([{ type: "uint256" }], [v]);
const addr = (v: string) => encodeAbiParameters([{ type: "address" }], [v as Hex]);
const str = (v: string) => encodeAbiParameters([{ type: "string" }], [v]);
const pad = (n: bigint) => n.toString(16).padStart(64, "0");

const SUPPORTS = sel("function supportsInterface(bytes4)");
// bytes4 の引数は左詰めで32バイトに埋められる
const IFACE_721 = "80ac58cd".padEnd(64, "0");
const IFACE_1155 = "d9b67a26".padEnd(64, "0");

// コントラクトごとの「コード」と「呼び出しへの答え」
const world: Record<string, { code: Hex; calls: Record<string, Hex> }> = {
  [NFT721]: {
    code: fakeCode([
      "function setBaseURI(string)",
      "function withdraw()",
      "function updateAllowedSeaDrop(address[])",
      "function getMintStats(address)",
    ]),
    calls: {
      [SUPPORTS + IFACE_721]: bool(true),
      [SUPPORTS + IFACE_1155]: bool(false),
      [sel("function name()")]: str("Test"),
      [sel("function symbol()")]: str("TST"),
      [sel("function owner()")]: addr(EOA),
      [sel("function totalSupply()")]: uint(120n),
      [sel("function maxSupply()")]: uint(1000n),
    },
  },
  [NFT1155]: {
    code: fakeCode(["function setURI(string)", "function withdraw(address)"]),
    calls: {
      [SUPPORTS + IFACE_721]: bool(false),
      [SUPPORTS + IFACE_1155]: bool(true),
      [sel("function owner()")]: addr(SAFE),
      [sel("function totalSupply(uint256)") + pad(7n)]: uint(55n),
      [sel("function maxSupply(uint256)") + pad(7n)]: uint(500n),
    },
  },
  [SAFE]: {
    code: "0x6080",
    calls: {
      [sel("function getThreshold()")]: uint(2n),
      [sel("function getOwners()")]: encodeAbiParameters([{ type: "address[]" }], [[EOA, NFT721, NFT1155] as Hex[]]),
    },
  },
  [NFT_OTHER_OWNER]: {
    code: fakeCode(["function pause()"]),
    calls: {
      [SUPPORTS + IFACE_721]: bool(true),
      [SUPPORTS + IFACE_1155]: bool(false),
      [sel("function owner()")]: addr(PLAIN_CONTRACT),
    },
  },
  [PLAIN_CONTRACT]: { code: "0x6080", calls: {} },
};

const client = createPublicClient({
  chain: base,
  transport: custom({
    async request({ method, params }: { method: string; params: any[] }) {
      if (method === "eth_getCode") return world[params[0].toLowerCase()]?.code ?? "0x";
      if (method === "eth_getStorageAt") return "0x" + "00".repeat(32);
      if (method === "eth_call") {
        const entry = world[params[0].to.toLowerCase()];
        const data: string = params[0].data.slice(2);
        const answer = entry?.calls[data];
        if (answer) return answer;
        throw new Error("execution reverted");
      }
      if (method === "eth_chainId") return "0x2105";
      throw new Error("unsupported " + method);
    },
  }),
}) as PublicClient;

let failed = 0;
function expect(label: string, ok: boolean) {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) failed++;
}
const notMeasured = (r: Awaited<ReturnType<typeof runMintCheck>>, item: string) =>
  r.notMeasured.find(n => n.item === item);

(async () => {
  // 小道具
  expect("hasSelector finds present", hasSelector(world[NFT721].code, "function withdraw()"));
  expect("hasSelector rejects absent", !hasSelector(world[NFT721].code, "function pause()"));
  const mp = ("0x363d3d373d3d3d363d73" + "ab".repeat(20) + "5af43d82803e903d91602b57fd5bf3") as Hex;
  expect("minimal proxy detected", minimalProxyTarget(mp)?.toLowerCase() === "0x" + "ab".repeat(20));
  expect("non-proxy not detected", minimalProxyTarget(world[NFT721].code) === null);
  expect("parseTokenId: empty is undefined", parseTokenId(null) === undefined && parseTokenId("") === undefined);
  expect("parseTokenId: number", parseTokenId("7") === 7n);
  expect("parseTokenId: invalid is null", parseTokenId("-1") === null && parseTokenId("0x1") === null);

  // ERC-721（単独の鍵がオーナー）
  const a = await runMintCheck(NFT721, client, { sourcify: false });
  expect("721: standard", a.basics.standard === "ERC-721");
  expect("721: name/symbol", a.basics.name === "Test" && a.basics.symbol === "TST");
  expect("721: name not in notMeasured", !notMeasured(a, "name"));
  expect("721: owner single key", a.control.ownerKind === "single_key" && a.control.multisig === null);
  expect("721: supply", a.mint.totalSupply === "120" && a.mint.maxSupply === "1000");
  expect("721: seadrop detected", a.mint.knownType === "seadrop");
  expect("721: metadata changeable", a.capabilities.canChangeMetadata === true);
  expect("721: withdraw found", a.capabilities.hasWithdraw === true);
  expect("721: pause not found", a.capabilities.canPauseTransfers === false);
  expect("721: flag OWNER_SINGLE_KEY", a.flags.some(f => f.code === "OWNER_SINGLE_KEY"));

  // ERC-1155、トークン番号なし
  const b = await runMintCheck(NFT1155, client, { sourcify: false });
  expect("1155: standard", b.basics.standard === "ERC-1155");
  expect("1155: name/symbol listed as not measured", !!notMeasured(b, "name") && !!notMeasured(b, "symbol"));
  expect("1155 no id: supply empty", b.mint.totalSupply === null && b.mint.tokenId === null);
  expect("1155 no id: reason asks for tokenId", /tokenId/.test(notMeasured(b, "totalSupply")?.reason ?? ""));
  expect("1155: owner is Safe 2 of 3",
    b.control.ownerKind === "contract" &&
      b.control.multisig?.type === "safe" &&
      b.control.multisig.threshold === 2 &&
      b.control.multisig.ownerCount === 3);
  expect("1155: no single-key flag", !b.flags.some(f => f.code === "OWNER_SINGLE_KEY"));

  // ERC-1155、トークン番号あり
  const c = await runMintCheck(NFT1155, client, { sourcify: false, tokenId: 7n });
  expect("1155 id=7: supply", c.mint.tokenId === "7" && c.mint.totalSupply === "55" && c.mint.maxSupply === "500");
  expect("1155 id=7: supply not in notMeasured", !notMeasured(c, "totalSupply") && !notMeasured(c, "maxSupply"));
  const d = await runMintCheck(NFT1155, client, { sourcify: false, tokenId: 8n });
  expect("1155 id=8: unreadable supply reported", d.mint.totalSupply === null && !!notMeasured(d, "totalSupply"));

  // オーナーが Safe ではないコントラクト
  const e = await runMintCheck(NFT_OTHER_OWNER, client, { sourcify: false });
  expect("other owner: contract, no multisig", e.control.ownerKind === "contract" && e.control.multisig === null);
  expect("other owner: reported as not analysed", !!notMeasured(e, "control.multisig"));
  expect("other owner: pausable", e.capabilities.canPauseTransfers === true);

  // コントラクトではないアドレス
  const f = await runMintCheck(EOA, client, { sourcify: false });
  expect("EOA flagged", f.flags.some(x => x.code === "NOT_A_CONTRACT"));

  console.log(failed === 0 ? "\nすべて通過" : `\n${failed} 件失敗`);
  if (failed) process.exitCode = 1;
})();
