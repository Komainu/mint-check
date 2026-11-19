/** 通信なしでチェック本体を確かめる簡易テスト: npx tsx scripts/selftest.ts */
import { createPublicClient, custom, encodeAbiParameters, keccak256, toBytes, toFunctionSelector, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";
import { hasSelector, minimalProxyTarget, parseTokenId, runMintCheck } from "../lib/products/mint-check/checks";
import { classifyUri } from "../lib/products/mint-check/extras";

const NFT721 = "0x1111111111111111111111111111111111111111";
const EOA = "0x2222222222222222222222222222222222222222";
const NFT1155 = "0x3333333333333333333333333333333333333333";
const SAFE = "0x4444444444444444444444444444444444444444";
const NFT_OTHER_OWNER = "0x5555555555555555555555555555555555555555";
const PLAIN_CONTRACT = "0x6666666666666666666666666666666666666666";
const NFT_RENOUNCED = "0x7777777777777777777777777777777777777777";
const ROYALTY_SAFE = SAFE;

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
const IFACE_2981 = "2a55205a".padEnd(64, "0");
const IFACE_AC = "7965db0b".padEnd(64, "0");
const IFACE_ACE = "5a05180f".padEnd(64, "0");
const padAddr = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");
const MINTER = keccak256(toBytes("MINTER_ROLE")).slice(2);
const ADMIN = "00".repeat(32);

// コントラクトごとの「コード」と「呼び出しへの答え」
const world: Record<string, { code: Hex; calls: Record<string, Hex> }> = {
  [NFT721]: {
    code: fakeCode([
      "function setBaseURI(string)",
      "function withdraw()",
      "function updateAllowedSeaDrop(address[])",
      "function getMintStats(address)",
      "function metadataFrozen()",
    ]),
    calls: {
      [SUPPORTS + IFACE_721]: bool(true),
      [SUPPORTS + IFACE_1155]: bool(false),
      [sel("function name()")]: str("Test"),
      [sel("function symbol()")]: str("TST"),
      [sel("function owner()")]: addr(EOA),
      [sel("function totalSupply()")]: uint(120n),
      [sel("function maxSupply()")]: uint(1000n),
      // v0.9: ipfs に置かれ凍結済み。オーナーが 40/120 枚を持つ。ロイヤルティは Safe 宛て 5%
      [sel("function tokenURI(uint256)") + pad(1n)]: str("ipfs://QmTestHash/1"),
      [sel("function metadataFrozen()")]: bool(true),
      [sel("function balanceOf(address)") + padAddr(EOA)]: uint(40n),
      [SUPPORTS + IFACE_2981]: bool(true),
      [sel("function royaltyInfo(uint256,uint256)") + pad(1n) + pad(10000n)]:
        encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [ROYALTY_SAFE as Hex, 500n]),
    },
  },
  [NFT_RENOUNCED]: {
    code: fakeCode(["function setDefaultRoyalty(address,uint96)", "function setBaseURI(string)", "function hasRole(bytes32,address)"]),
    calls: {
      [SUPPORTS + IFACE_721]: bool(true),
      [SUPPORTS + IFACE_1155]: bool(false),
      [sel("function owner()")]: addr("0x0000000000000000000000000000000000000000"),
      [sel("function totalSupply()")]: uint(10n),
      [sel("function tokenURI(uint256)") + pad(0n)]: str("https://api.example.com/meta/0"),
      [SUPPORTS + IFACE_AC]: bool(true),
      [SUPPORTS + IFACE_ACE]: bool(true),
      [sel("function getRoleMemberCount(bytes32)") + MINTER]: uint(1n),
      [sel("function getRoleMember(bytes32,uint256)") + MINTER + pad(0n)]: addr(EOA),
      [sel("function getRoleMemberCount(bytes32)") + ADMIN]: uint(0n),
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

const flakyOnce = new Set<string>([sel("function balanceOf(address)") + "0".repeat(24) + EOA.slice(2).toLowerCase()]);

const client = createPublicClient({
  chain: base,
  transport: custom({
    async request({ method, params }: { method: string; params: any[] }) {
      if (method === "eth_getCode") return world[params[0].toLowerCase()]?.code ?? "0x";
      if (method === "eth_getStorageAt") return "0x" + "00".repeat(32);
      if (method === "eth_call") {
        const entry = world[params[0].to.toLowerCase()];
        const data: string = params[0].data.slice(2);
        // 公開RPCに一度断られる状況を再現（1回目だけ失敗）
        if (flakyOnce.has(data)) {
          flakyOnce.delete(data);
          throw new Error("429 Too Many Requests");
        }
        const answer = entry?.calls[data];
        if (answer) return answer;
        throw new Error("execution reverted");
      }
      if (method === "eth_chainId") return "0x2105";
      throw new Error("unsupported " + method);
    },
  }, { retryCount: 0 }),
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

  // v0.9 の追加点検
  expect("classify: ipfs", classifyUri("ipfs://Qm/1") === "ipfs");
  expect("classify: ipfs gateway", classifyUri("https://ipfs.io/ipfs/QmXyz/1") === "ipfs");
  expect("classify: arweave", classifyUri("ar://abc") === "arweave" && classifyUri("https://arweave.net/abc") === "arweave");
  expect("classify: data", classifyUri("data:application/json;base64,e30=") === "onchain_data");
  expect("classify: web", classifyUri("https://api.example.com/1") === "web");
  expect("721: metadata on ipfs, frozen", a.capabilities.metadata?.location === "ipfs" && a.capabilities.metadata.frozen === true && a.capabilities.metadata.sampleTokenId === "1");
  expect("721: no web-server flag", !a.flags.some(x => x.code === "METADATA_ON_WEB_SERVER"));
  expect("721: royalty to Safe 5%", a.control.royalty?.bps === 500 && a.control.royalty.receiverKind === "contract");
  expect("721: royalty not changeable", a.capabilities.canChangeRoyalty === false);
  expect("721: balance read survives one RPC refusal", flakyOnce.size === 0 && a.mint.insiderHoldings?.owner === "40");
  expect("721: owner holds 40", a.mint.insiderHoldings?.owner === "40" && Math.abs((a.mint.insiderHoldings.shareOfSupply ?? 0) - 0.3333) < 0.001);
  expect("721: flag INSIDERS_HOLD_LARGE_SHARE", a.flags.some(x => x.code === "INSIDERS_HOLD_LARGE_SHARE"));
  expect("721: no AccessControl", a.control.roles === null);

  const g = await runMintCheck(NFT_RENOUNCED, client, { sourcify: false });
  expect("renounced: owner kind", g.control.ownerKind === "renounced");
  expect("renounced: sample falls back to token 0", g.capabilities.metadata?.sampleTokenId === "0");
  expect("renounced: metadata on web server flagged", g.capabilities.metadata?.location === "web" && g.flags.some(x => x.code === "METADATA_ON_WEB_SERVER"));
  expect("renounced: freeze unknown", g.capabilities.metadata?.frozen === null && !!notMeasured(g, "capabilities.metadata.frozen"));
  expect("renounced: royalty changeable", g.capabilities.canChangeRoyalty === true && g.flags.some(x => x.code === "ROYALTY_CHANGEABLE"));
  expect("renounced: royalty setter listed", g.capabilities.matchedFunctions.includes("setDefaultRoyalty(address,uint96)"));
  expect("renounced: MINTER_ROLE listed", g.control.roles?.enumerable === true && g.control.roles.holders.some(h => h.role === "MINTER_ROLE" && h.count === 1 && h.members[0]?.kind === "single_key"));
  expect("renounced: admin role with 0 members omitted", !g.control.roles?.holders.some(h => h.role === "DEFAULT_ADMIN_ROLE"));
  expect("renounced: flag ROLES_REMAIN_AFTER_RENOUNCE", g.flags.some(x => x.code === "ROLES_REMAIN_AFTER_RENOUNCE"));
  expect("renounced: flag ROLE_HELD_BY_SINGLE_KEY", g.flags.some(x => x.code === "ROLE_HELD_BY_SINGLE_KEY"));
  expect("renounced: holdings not measured", g.mint.insiderHoldings?.owner === null && !!notMeasured(g, "mint.insiderHoldings"));

  expect("1155 no id: holdings ask for tokenId", /tokenId/.test(notMeasured(b, "mint.insiderHoldings")?.reason ?? ""));
  expect("EOA: extras untouched", f.capabilities.metadata === null && f.control.roles === null);

  console.log(failed === 0 ? "\nすべて通過" : `\n${failed} 件失敗`);
  if (failed) process.exitCode = 1;
})();
