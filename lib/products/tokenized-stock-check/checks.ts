/**
 * Tokenized Stock Check の本体（3号商品、2026-11-20 試作）。
 * Base 上のトークン化米国株のアドレスを受け取り、発行元ごとの仕組みで「止まっているか」
 * 「誰が止められるか・没収できるか・中身を差し替えられるか」「価格フィードは新しいか」
 * 「いま米国市場は開いているか」を事実として返す。買う／避けるの判断はしない。
 *
 * 対応する発行元（この版）:
 *   - Coinbase（B20 ネイティブトークン）: pausedFeatures、ポリシー（ブロックリスト等）、没収、上限、配当の倍率、Chainlink
 *   - Dinari（dShares）: paused、送金制限（ブラックリスト）、ビーコンでの一括差し替えと、その権限
 * それ以外（Anchored・Swarm・Backed など）は issuer=unknown として notMeasured に書く。
 *
 * チェーン上の調べ方は 2026-11-20 に NVDAc（0xb200…108C）と Dinari AAPL（0x41F7…6348）で確かめた。
 */
import { getAddress, keccak256, toBytes, type Address, type Hex, type PublicClient } from "viem";

export type HolderKind = "single_key" | "contract";
type Flag = { code: string; note: string };

const B20_PREFIX = "0xb20000000000000000000";
const POLICY_REGISTRY = "0x8453000000000000000000000000000000000002" as Address;
const B20_FEATURES = ["TRANSFER", "MINT", "BURN", "SEIZE"] as const;
const UINT128_MAX = (1n << 128n) - 1n;

/** ポリシーの性格を見るための、どこにも登録されていないはずのアドレス */
export const PROBE_ADDRESS = getAddress(("0x" + keccak256(toBytes("tokenized-stock-check/probe")).slice(26)) as Hex);

/** Coinbase 株の Chainlink フィード（Base 公式ドキュメント、2026-11-20 時点） */
export const COINBASE_FEEDS: Record<string, Address> = {
  AAPL: "0x787f13dEa48Db0897CbCDD985de77809D837F988",
  AMZN: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295",
  GOOGL: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2",
  META: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D",
  MSFT: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c",
  MSTR: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a",
  NVDA: "0x04689a41629776563E6822F76f2e57D148d28513",
  SNDK: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA",
  SPCX: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68",
  TSLA: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4",
};

const fn = (name: string, inputs: string[], outputs: string[]) =>
  ({
    type: "function",
    name,
    stateMutability: "view",
    inputs: inputs.map(type => ({ type })),
    outputs: outputs.map(type => ({ type })),
  }) as const;

const ABI = [
  fn("name", [], ["string"]),
  fn("symbol", [], ["string"]),
  fn("decimals", [], ["uint8"]),
  fn("totalSupply", [], ["uint256"]),
  // B20
  fn("pausedFeatures", [], ["uint8[]"]),
  fn("supplyCap", [], ["uint256"]),
  fn("uiMultiplier", [], ["uint256"]),
  fn("TRANSFER_SENDER_POLICY", [], ["bytes32"]),
  fn("TRANSFER_RECEIVER_POLICY", [], ["bytes32"]),
  fn("SEIZE_EXEMPT_POLICY", [], ["bytes32"]),
  fn("policyId", ["bytes32"], ["uint64"]),
  // Dinari
  fn("paused", [], ["bool"]),
  fn("transferRestrictor", [], ["address"]),
  fn("balancePerShare", [], ["uint256"]),
  fn("implementation", [], ["address"]),
  fn("owner", [], ["address"]),
  fn("isBlacklisted", ["address"], ["bool"]),
  // ポリシー登録簿
  fn("policyAdmin", ["uint64"], ["address"]),
  fn("isAuthorized", ["uint64", "address"], ["bool"]),
  // Chainlink
  fn("description", [], ["string"]),
  fn("latestRoundData", [], ["uint80", "int256", "uint256", "uint256", "uint80"]),
] as const;

async function tryRead<T>(f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch {
    return null;
  }
}
/** 公開RPCに断られたときのため、大事な読み取りは1回だけやり直す */
async function readTwice<T>(f: () => Promise<T>): Promise<T | null> {
  const a = await tryRead(f);
  if (a !== null) return a;
  await new Promise(r => setTimeout(r, 400));
  return tryRead(f);
}

function reader(client: PublicClient, address: Address) {
  return <T>(functionName: string, args: unknown[] = []) =>
    readTwice(() => client.readContract({ address, abi: ABI, functionName, args } as never)) as Promise<T | null>;
}

async function kindOf(client: PublicClient, a: Address): Promise<HolderKind | null> {
  const code = await readTwice(() => client.getCode({ address: a }));
  if (code === null) return null;
  if (!code || code === "0x" || code.toLowerCase().startsWith("0xef0100")) return "single_key";
  return "contract";
}

/**
 * 米国株の時間。2つを分けて返す（2026-11-21 修正）:
 *   - 通常取引（regular）: ニューヨーク時間 月〜金 9:30〜16:00
 *   - Chainlink の株価フィードが動く時間（feedWindowOpen）: 日曜 20:00 〜 金曜 20:00
 *     時間外・夜間取引も含むので、価格が本当に止まるのは週末（と祝日）だけ
 * 祝日は見ない。
 */
export function usMarketSession(now: Date): {
  open: boolean;
  session: "regular" | "extended" | "weekend";
  feedWindowOpen: boolean;
  newYorkTime: string;
} {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map(p => [p.type, p.value]),
  );
  const hour = Number(parts.hour) % 24;
  const minutes = hour * 60 + Number(parts.minute);
  const day = parts.weekday as string;
  const newYorkTime = `${parts.year}-${parts.month}-${parts.day} ${String(hour).padStart(2, "0")}:${parts.minute} ${day}`;
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(day);
  const open = weekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  const feedWindowOpen =
    ["Mon", "Tue", "Wed", "Thu"].includes(day) || (day === "Fri" && minutes < 20 * 60) || (day === "Sun" && minutes >= 20 * 60);
  return { open, session: open ? "regular" : feedWindowOpen ? "extended" : "weekend", feedWindowOpen, newYorkTime };
}

type PolicyInfo = { scope: string; policyId: string; openByDefault: boolean | null; admin: Address | null; adminKind: HolderKind | null } | null;

async function readPolicy(client: PublicClient, token: Address, scopeFn: string): Promise<PolicyInfo> {
  const read = reader(client, token);
  const scope = await read<Hex>(scopeFn);
  if (!scope) return null;
  const id = await read<bigint>("policyId", [scope]);
  if (id === null) return null;
  const reg = reader(client, POLICY_REGISTRY);
  const [admin, authorized] = await Promise.all([
    id === 0n ? Promise.resolve(null) : reg<Address>("policyAdmin", [id]),
    reg<boolean>("isAuthorized", [id, PROBE_ADDRESS]),
  ]);
  const realAdmin = admin && !/^0x0{40}$/i.test(admin) ? getAddress(admin) : null;
  return {
    scope: scopeFn,
    policyId: id.toString(),
    openByDefault: authorized,
    admin: realAdmin,
    adminKind: realAdmin ? await kindOf(client, realAdmin) : null,
  };
}

export type StockCheckOptions = { client: PublicClient; now?: () => Date };

export async function runStockCheck(rawAddress: string, opts: StockCheckOptions) {
  const { client } = opts;
  const now = (opts.now ?? (() => new Date()))();
  const address = getAddress(rawAddress);
  const read = reader(client, address);
  const flags: Flag[] = [];
  const notMeasured: { item: string; reason: string }[] = [];

  const code = await readTwice(() => client.getCode({ address }));
  if (code === null) throw new Error("rpc");
  const isB20 = address.toLowerCase().startsWith(B20_PREFIX);
  if (!isB20 && (!code || code === "0x")) {
    return {
      address,
      chain: "base",
      checkedAt: now.toISOString(),
      issuer: "unknown",
      flags: [{ code: "NOT_A_CONTRACT", note: "This address has no code on Base." }],
      notMeasured,
    };
  }

  const [name, symbol, decimals, totalSupply] = await Promise.all([
    read<string>("name"),
    read<string>("symbol"),
    read<number>("decimals"),
    read<bigint>("totalSupply"),
  ]);
  const dec = decimals ?? 18;
  const token = {
    name,
    symbol,
    decimals,
    totalSupply: totalSupply != null ? (Number(totalSupply) / 10 ** dec).toString() : null,
  };

  const market = usMarketSession(now);
  notMeasured.push({
    item: "market.holidays",
    reason: "US market holidays and early closes are not checked (regular session: weekdays 9:30-16:00 New York; price feed: Sunday 20:00 to Friday 20:00 New York).",
  });
  if (!market.feedWindowOpen) {
    flags.push({
      code: "PRICE_FEED_FROZEN_WEEKEND",
      note: "Weekend: on-chain price feeds hold Friday 20:00 New York values until Sunday 20:00. DEX prices can drift from them, and lending positions can be liquidated in a gap when feeds reopen.",
    });
  }

  // ---------- Coinbase（B20） ----------
  if (isB20) {
    const [paused, cap, multiplier] = await Promise.all([
      read<readonly number[]>("pausedFeatures"),
      read<bigint>("supplyCap"),
      read<bigint>("uiMultiplier"),
    ]);
    const pausedNames = paused ? paused.map(i => B20_FEATURES[i] ?? `FEATURE_${i}`) : null;
    if (pausedNames === null) notMeasured.push({ item: "status.pausedFeatures", reason: "pausedFeatures() could not be read." });
    for (const f of pausedNames ?? []) flags.push({ code: `${f}_PAUSED`, note: `${f} is paused by the issuer right now.` });

    const transferSender = await readPolicy(client, address, "TRANSFER_SENDER_POLICY");
    const transferReceiver = await readPolicy(client, address, "TRANSFER_RECEIVER_POLICY");
    const seize = await readPolicy(client, address, "SEIZE_EXEMPT_POLICY");
    const seenPolicies = new Set<string>();
    for (const p of [transferSender, transferReceiver]) {
      if (!p || p.policyId === "0") continue;
      // 送る側と受け取る側が同じポリシーなら、注意は1回だけ出す
      if (seenPolicies.has(p.policyId)) continue;
      seenPolicies.add(p.policyId);
      const both = transferSender?.policyId === transferReceiver?.policyId;
      const scopeLabel = both ? "TRANSFER_SENDER_POLICY and TRANSFER_RECEIVER_POLICY" : p.scope;
      if (p.openByDefault === false) {
        flags.push({ code: "TRANSFERS_ALLOWLIST_ONLY", note: `${scopeLabel}: only listed addresses can send or receive.` });
      } else {
        flags.push({ code: "ISSUER_CAN_BLOCK_ADDRESSES", note: `${scopeLabel}: policy ${p.policyId} can block individual addresses from transferring.` });
      }
      if (p.adminKind === "single_key") {
        flags.push({ code: "BLOCKLIST_ADMIN_SINGLE_KEY", note: `${scopeLabel}: the policy admin is a single key.` });
      }
    }
    if (seize && seize.policyId !== "0") {
      flags.push({
        code: "SEIZE_CONFIGURED",
        note: `Seize is configured (policy ${seize.policyId}): the issuer can move balances out of addresses that the policy does not exempt.`,
      });
    }
    if (!seize) notMeasured.push({ item: "controls.seize", reason: "Seize policy slot could not be read." });
    notMeasured.push({ item: "controls.roles", reason: "B20 roles (mint, pause, seize, operator) cannot be listed on-chain; only role checks for a known address are possible." });

    // 価格（Chainlink）
    const ticker = symbol && /c$/.test(symbol) ? symbol.slice(0, -1).toUpperCase() : null;
    const feed = ticker ? COINBASE_FEEDS[ticker] : undefined;
    let price: Record<string, unknown> | null = null;
    if (feed) {
      const f = reader(client, feed);
      const [desc, round] = await Promise.all([f<string>("description"), f<readonly [bigint, bigint, bigint, bigint, bigint]>("latestRoundData")]);
      if (round && desc && desc.toUpperCase().includes(ticker!)) {
        const updatedAt = Number(round[3]);
        const ageSeconds = Math.max(0, Math.floor(now.getTime() / 1000) - updatedAt);
        price = {
          source: "chainlink",
          feed,
          description: desc,
          answerUsd: Number(round[1]) / 1e8,
          updatedAt: new Date(updatedAt * 1000).toISOString(),
          ageSeconds,
          note: "Total-return value (underlying price x multiplier). Updates Sunday 20:00 to Friday 20:00 New York including extended hours; holds the last value on weekends and during corporate-action pauses.",
        };
        if (market.feedWindowOpen && ageSeconds > 26 * 3600) {
          flags.push({ code: "PRICE_FEED_STALE", note: `The feed should be updating now but was last updated ${Math.round(ageSeconds / 3600)} h ago (heartbeat 24 h). It may be frozen for a corporate action.` });
        }
      } else {
        notMeasured.push({ item: "price", reason: "The Chainlink feed for this ticker could not be read or did not match." });
      }
    } else {
      notMeasured.push({ item: "price", reason: `No known Chainlink feed for ${symbol ?? "this token"} in this version.` });
    }

    return {
      address,
      chain: "base",
      checkedAt: now.toISOString(),
      issuer: "coinbase_b20",
      token,
      status: { pausedFeatures: pausedNames },
      controls: {
        supplyCap: cap == null ? null : cap >= UINT128_MAX ? "uncapped" : (Number(cap) / 10 ** dec).toString(),
        dividendMultiplier: multiplier != null ? Number(multiplier) / 1e18 : null,
        transferSenderPolicy: transferSender,
        transferReceiverPolicy: transferReceiver,
        seizePolicy: seize,
      },
      price,
      market,
      flags,
      notMeasured,
      disclaimer: DISCLAIMER,
    };
  }

  // ---------- Dinari（dShares） ----------
  const [restrictor, bps, pausedFlag] = await Promise.all([
    read<Address>("transferRestrictor"),
    read<bigint>("balancePerShare"),
    read<boolean>("paused"),
  ]);
  const looksDinari = (name ?? "").endsWith(" - Dinari") || (restrictor != null && bps != null);
  if (!looksDinari) {
    notMeasured.push({
      item: "issuer",
      reason: "Not a Coinbase (B20) or Dinari token. Anchored, Swarm, Backed and other issuers are not supported in this version.",
    });
    return { address, chain: "base", checkedAt: now.toISOString(), issuer: "unknown", token, market, flags, notMeasured, disclaimer: DISCLAIMER };
  }

  // ビーコン型プロキシ: コードに埋め込まれたビーコンの住所を取り出す（PUSH32 で 12 バイトの 0 + 住所）
  let beacon: Address | null = null;
  const m = code && code.toLowerCase().match(/7f000000000000000000000000([0-9a-f]{40})73f{40}16635c60da1b/);
  if (m) beacon = getAddress(("0x" + m[1]) as Hex);
  let upgrade: Record<string, unknown> | null = null;
  if (beacon) {
    const b = reader(client, beacon);
    const [impl, owner] = await Promise.all([b<Address>("implementation"), b<Address>("owner")]);
    const ownerKind = owner ? await kindOf(client, owner) : null;
    upgrade = { kind: "beacon_proxy", beacon, implementation: impl, beaconOwner: owner, beaconOwnerKind: ownerKind };
    flags.push({ code: "UPGRADEABLE_BY_BEACON", note: "Token logic can be replaced, for all tokens sharing this beacon at once, by the beacon owner." });
    if (ownerKind === "single_key") flags.push({ code: "UPGRADE_KEY_SINGLE", note: "The beacon owner (who can upgrade) is a single key." });
  } else {
    notMeasured.push({ item: "controls.upgrade", reason: "Proxy layout not recognized; upgradeability was not analysed." });
  }
  if (pausedFlag === true) flags.push({ code: "TRANSFER_PAUSED", note: "The token is paused by the issuer right now." });
  if (pausedFlag === null) notMeasured.push({ item: "status.paused", reason: "paused() could not be read." });
  let restrictorInfo: Record<string, unknown> | null = null;
  if (restrictor && !/^0x0{40}$/i.test(restrictor)) {
    const probe = await reader(client, restrictor)<boolean>("isBlacklisted", [PROBE_ADDRESS]);
    restrictorInfo = { address: getAddress(restrictor), hasBlacklist: probe !== null };
    if (probe !== null) flags.push({ code: "ISSUER_CAN_BLOCK_ADDRESSES", note: "A transfer restrictor with a blacklist is attached." });
  }
  notMeasured.push({ item: "price", reason: "Dinari publishes prices through its own API; there is no on-chain price feed for dShares on Base." });
  notMeasured.push({ item: "redemption", reason: "dShares can generally be sold back only to Dinari; redemption availability is off-chain." });

  return {
    address,
    chain: "base",
    checkedAt: now.toISOString(),
    issuer: "dinari",
    token,
    status: { paused: pausedFlag },
    controls: {
      sharesPerToken: bps != null ? Number(bps) / 1e18 : null,
      transferRestrictor: restrictorInfo,
      upgrade,
    },
    price: null,
    market,
    flags,
    notMeasured,
    disclaimer: DISCLAIMER,
  };
}

const DISCLAIMER =
  "On-chain facts about the issuer's controls and price feed. A tokenized stock is a claim on the issuer, not a share. Not investment advice.";
