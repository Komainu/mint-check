/** 通信なしでチェック本体を確かめる簡易テスト: npx tsx scripts/selftest.ts */
import { createPublicClient, custom, encodeAbiParameters, toFunctionSelector, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";
import { hasSelector, minimalProxyTarget, runMintCheck } from "../lib/checks";

const NFT = "0x1111111111111111111111111111111111111111";
const OWNER = "0x2222222222222222222222222222222222222222";
const sel = (s: string) => toFunctionSelector(s).slice(2);
// セレクタを PUSH4 で並べただけの偽バイトコード
const nftCode = ("0x6080" +
  ["function setBaseURI(string)", "function withdraw()", "function updateAllowedSeaDrop(address[])", "function getMintStats(address)"]
    .map(s => "63" + sel(s))
    .join("")) as Hex;

const answers: Record<string, Hex> = {
  [sel("function supportsInterface(bytes4)") + "80ac58cd"]: encodeAbiParameters([{ type: "bool" }], [true]),
  [sel("function supportsInterface(bytes4)") + "d9b67a26"]: encodeAbiParameters([{ type: "bool" }], [false]),
  [sel("function name()")]: encodeAbiParameters([{ type: "string" }], ["Test"]),
  [sel("function symbol()")]: encodeAbiParameters([{ type: "string" }], ["TST"]),
  [sel("function owner()")]: encodeAbiParameters([{ type: "address" }], [OWNER]),
  [sel("function totalSupply()")]: encodeAbiParameters([{ type: "uint256" }], [120n]),
  [sel("function maxSupply()")]: encodeAbiParameters([{ type: "uint256" }], [1000n]),
};

const client = createPublicClient({
  chain: base,
  transport: custom({
    async request({ method, params }: { method: string; params: any[] }) {
      if (method === "eth_getCode") return params[0].toLowerCase() === NFT ? nftCode : "0x";
      if (method === "eth_getStorageAt") return "0x" + "00".repeat(32);
      if (method === "eth_call") {
        const data: string = params[0].data.slice(2);
        const key = Object.keys(answers).find(k => data.startsWith(k));
        if (key) return answers[key];
        throw new Error("execution reverted");
      }
      if (method === "eth_chainId") return "0x2105";
      throw new Error("unsupported " + method);
    },
  }),
}) as PublicClient;

function expect(label: string, ok: boolean) {
  console.log((ok ? "OK  " : "NG  ") + label);
  if (!ok) process.exitCode = 1;
}

(async () => {
  expect("hasSelector finds present", hasSelector(nftCode, "function withdraw()"));
  expect("hasSelector rejects absent", !hasSelector(nftCode, "function pause()"));
  const mp = ("0x363d3d373d3d3d363d73" + "ab".repeat(20) + "5af43d82803e903d91602b57fd5bf3") as Hex;
  expect("minimal proxy detected", minimalProxyTarget(mp)?.toLowerCase() === "0x" + "ab".repeat(20));
  expect("non-proxy not detected", minimalProxyTarget(nftCode) === null);

  const r = await runMintCheck(NFT, client, { sourcify: false });
  expect("standard ERC-721", r.basics.standard === "ERC-721");
  expect("name/symbol", r.basics.name === "Test" && r.basics.symbol === "TST");
  expect("owner single key", r.control.ownerKind === "single_key");
  expect("supply", r.mint.totalSupply === "120" && r.mint.maxSupply === "1000");
  expect("seadrop detected", r.mint.knownType === "seadrop");
  expect("metadata changeable", r.capabilities.canChangeMetadata === true);
  expect("withdraw found", r.capabilities.hasWithdraw === true);
  expect("pause not found", r.capabilities.canPauseTransfers === false);
  expect("not a proxy", r.code.isProxy === false);
  expect("flag OWNER_SINGLE_KEY", r.flags.some(f => f.code === "OWNER_SINGLE_KEY"));

  const eoa = await runMintCheck(OWNER, client, { sourcify: false });
  expect("EOA flagged", eoa.flags.some(f => f.code === "NOT_A_CONTRACT"));
})();
