/**
 * x402 Seller Check の本体: 支払いなしで受け取った 402 を解読し、
 * 「この店に払えるか」「払った後の手続きで弾かれそうな点はないか」を項目ごとに点検する。
 *
 * 点検項目の多くは、Mint Check を出すときに実際に起きた失敗から来ている:
 *   - 説明文が 500 文字を超えて CDP の facilitator が支払いの検証を拒否した
 *   - extra.name / extra.version がトークンの EIP-712 名と違うと署名が通らない
 *   - Bazaar 用の入出力の情報が無いと、検索から見つけてもらえない
 * お金の判断（買うべき・危ない）は出さない。出すのは事実と、その根拠だけ。
 */
import { createPublicClient, http, isAddress, getAddress, type PublicClient } from "viem";
import { base, baseSepolia } from "viem/chains";
import type { ProbeResponse, Prober } from "./probe";

export type CheckStatus = "pass" | "warn" | "fail" | "info";
export type Check = { id: string; status: CheckStatus; message: string };

type Accept = Record<string, unknown>;

/** よく使われる USDC（6桁）。ネットワークは CAIP-2 */
const KNOWN_USDC: Record<string, { address: string; label: string }> = {
  "eip155:8453": { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", label: "USDC on Base" },
  "eip155:84532": { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", label: "USDC on Base Sepolia" },
  "eip155:137": { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", label: "USDC on Polygon" },
  "eip155:42161": { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", label: "USDC on Arbitrum" },
};

/** x402 v1 のネットワーク名 → CAIP-2 */
const V1_NETWORKS: Record<string, string> = {
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  polygon: "eip155:137",
  arbitrum: "eip155:42161",
  avalanche: "eip155:43114",
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

/** オンチェーンで確かめられるネットワーク（EIP-712 名・受取先のコード） */
export type Clients = Partial<Record<string, PublicClient>>;

export function makeClients(): Clients {
  return {
    "eip155:8453": createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) }) as PublicClient,
    "eip155:84532": createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.BASE_SEPOLIA_RPC_URL),
    }) as PublicClient,
  };
}

const CDP_DESCRIPTION_LIMIT = 500;
const KNOWN_SCHEMES = new Set(["exact", "upto"]);

const ERC20_META_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  {
    type: "function",
    name: "eip712Domain",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "fields", type: "bytes1" },
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "salt", type: "bytes32" },
      { name: "extensions", type: "uint256[]" },
    ],
  },
] as const;

/** 402 から支払い条件を取り出す（v2 はヘッダー、v1 は本文） */
export function decodePaymentRequired(res: ProbeResponse): {
  source: "header" | "body" | null;
  data: Record<string, unknown> | null;
  error?: string;
} {
  const header = res.headers["payment-required"];
  if (header) {
    try {
      const json = JSON.parse(Buffer.from(header.trim(), "base64").toString("utf8"));
      if (json && typeof json === "object" && !Array.isArray(json)) return { source: "header", data: json };
      return { source: "header", data: null, error: "PAYMENT-REQUIRED header is not a JSON object." };
    } catch {
      return { source: "header", data: null, error: "PAYMENT-REQUIRED header is not base64 JSON." };
    }
  }
  try {
    const json = JSON.parse(res.body);
    if (json && typeof json === "object" && !Array.isArray(json) && Array.isArray((json as Accept).accepts)) {
      return { source: "body", data: json };
    }
  } catch {
    /* 本文が JSON でない */
  }
  return { source: null, data: null };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function short(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 金額（最小単位）を USD に。既知の USDC のときだけ */
function priceUsd(network: string | null, asset: string | null, amount: string | null): number | null {
  if (!network || !asset || !amount || !/^\d+$/.test(amount)) return null;
  const k = KNOWN_USDC[network];
  if (!k || k.address.toLowerCase() !== asset.toLowerCase()) return null;
  return Number(amount) / 1e6;
}

async function readEip712(client: PublicClient, asset: `0x${string}`) {
  try {
    const d = await client.readContract({ address: asset, abi: ERC20_META_ABI, functionName: "eip712Domain" });
    return { name: d[1], version: d[2], source: "eip712Domain()" };
  } catch {
    /* EIP-5267 がない。name() と version() を読む */
  }
  const [name, version] = await Promise.all([
    client.readContract({ address: asset, abi: ERC20_META_ABI, functionName: "name" }).catch(() => null),
    client.readContract({ address: asset, abi: ERC20_META_ABI, functionName: "version" }).catch(() => null),
  ]);
  return { name, version, source: "name()/version()" };
}

export type SellerCheckOptions = { prober: Prober; clients: Clients; now?: () => Date };

export async function runSellerCheck(url: URL, method: "GET" | "POST", opts: SellerCheckOptions) {
  const checks: Check[] = [];
  const add = (id: string, status: CheckStatus, message: string) => checks.push({ id, status, message });
  const notMeasured: { item: string; reason: string }[] = [
    { item: "delivery_after_payment", reason: "This check never pays, so it cannot see what the seller returns after payment." },
    { item: "server_route_config", reason: "Server-side settings (route matching, facilitator keys) are not visible from outside." },
    { item: "payment_history", reason: "Past payments to payTo and Bazaar call counts are not read in this version." },
  ];
  const checkedAt = (opts.now ?? (() => new Date()))().toISOString();

  let res: ProbeResponse;
  try {
    res = await opts.prober(url, method);
  } catch (e) {
    const code = (e as { code?: string }).code;
    const why =
      code === "EBLOCKED"
        ? "the host resolves to a private or reserved address"
        : code === "ETIMEOUT"
          ? "no answer within 8 seconds"
          : code === "ENOTFOUND"
            ? "the host name does not resolve"
            : "the connection failed (TLS or network error)";
    return { unreachable: true as const, reason: why };
  }

  const httpInfo = {
    status: res.status,
    latencyMs: res.latencyMs,
    redirectTo: res.status >= 300 && res.status < 400 ? (res.headers["location"] ?? null) : null,
  };

  // 1. 支払いなしで 402 を返すか
  if (res.status === 402) add("answers_402", "pass", `Unpaid ${method} answered 402 in ${res.latencyMs} ms.`);
  else if (httpInfo.redirectTo) add("answers_402", "fail", `Unpaid ${method} redirected (${res.status}) to ${short(httpInfo.redirectTo)}. Buyers usually call the final URL; list that one.`);
  else if (res.status >= 200 && res.status < 300) add("answers_402", "fail", `Unpaid ${method} answered ${res.status}: the content is served without payment, or this is not the paid route.`);
  else if (res.status === 405 || res.status === 404) add("answers_402", "fail", `Unpaid ${method} answered ${res.status}. Try the other method (GET/POST): the paid route may only accept one.`);
  else add("answers_402", "fail", `Unpaid ${method} answered ${res.status}, not 402.`);

  if (res.latencyMs > 5000) add("latency", "warn", `Slow answer: ${res.latencyMs} ms before any payment work.`);

  const decoded = decodePaymentRequired(res);
  const pr = decoded.data;
  if (decoded.error) add("payment_required", "fail", decoded.error);
  if (res.status === 402 && !pr && !decoded.error) {
    add("payment_required", "fail", "402 without x402 payment requirements (no PAYMENT-REQUIRED header and no accepts in the body).");
  }

  const x402Version = pr && typeof pr.x402Version === "number" ? pr.x402Version : null;
  if (pr) {
    if (x402Version === 2 && decoded.source === "header") add("x402_version", "pass", "x402 v2: requirements in the PAYMENT-REQUIRED header.");
    else if (x402Version === 1) add("x402_version", "info", `x402 v1: requirements in the response ${decoded.source}. v2-only buyers may skip it.`);
    else if (x402Version === 2) add("x402_version", "warn", "x402 v2 requirements found in the body, not the PAYMENT-REQUIRED header. v2 clients read the header.");
    else add("x402_version", "fail", "x402Version is missing or not a number.");
  }

  // 2. resource（v2）。v1 は accepts の中に resource と description がある
  const resource = pr && pr.resource && typeof pr.resource === "object" ? (pr.resource as Record<string, unknown>) : null;
  const rawAccepts = pr && Array.isArray(pr.accepts) ? (pr.accepts as unknown[]) : [];
  const accepts = rawAccepts.filter((a): a is Accept => !!a && typeof a === "object");
  const firstV1 = x402Version === 1 ? accepts[0] : undefined;
  const resourceUrl = str(resource?.url) ?? str(firstV1?.resource);
  const description = str(resource?.description) ?? str(firstV1?.description);
  const serviceName = str(resource?.serviceName);
  const tags = Array.isArray(resource?.tags) ? (resource!.tags as unknown[]).filter(t => typeof t === "string") as string[] : [];

  if (pr) {
    if (!resourceUrl) add("resource_url", "warn", "No resource URL in the requirements.");
    else {
      let ru: URL | null = null;
      try {
        ru = new URL(resourceUrl);
      } catch {
        /* 下で報告 */
      }
      if (!ru) add("resource_url", "fail", `resource.url is not a valid URL: ${short(resourceUrl)}`);
      else if (ru.protocol !== "https:") add("resource_url", "fail", `resource.url is not https (${ru.protocol}). Buyers and indexers expect the public https URL.`);
      else if (ru.host !== url.host) add("resource_url", "warn", `resource.url host (${ru.host}) differs from the URL called (${url.host}), e.g. an internal or old domain.`);
      else if (ru.pathname !== url.pathname) add("resource_url", "warn", `resource.url path (${ru.pathname}) differs from the path called (${url.pathname}).`);
      else add("resource_url", "pass", "resource.url is the public https URL that was called.");
    }

    if (!description) add("description", "warn", "No description. Agents choose sellers by it.");
    else if (description.length > CDP_DESCRIPTION_LIMIT) {
      add("description", "fail", `Description is ${description.length} characters. The CDP facilitator rejects payments whose description exceeds ${CDP_DESCRIPTION_LIMIT}.`);
    } else add("description", "pass", `Description is ${description.length} characters (limit ${CDP_DESCRIPTION_LIMIT}).`);

    if (serviceName && !/^[\x20-\x7e]{1,32}$/.test(serviceName)) add("service_name", "warn", "serviceName should be ASCII, 32 characters or fewer.");
    if (tags.length > 5 || tags.some(t => !/^[\x20-\x7e]{1,32}$/.test(t))) add("tags", "warn", "Tags should be at most 5, each ASCII and 32 characters or fewer.");
  }

  // 3. 支払いの選択肢ごと
  if (pr && accepts.length === 0) add("accepts", "fail", "accepts is empty: there is no way to pay.");
  const outAccepts: Record<string, unknown>[] = [];
  for (const [i, a] of accepts.entries()) {
    const p = `accepts[${i}]`;
    const scheme = str(a.scheme);
    const rawNetwork = str(a.network);
    const network = rawNetwork ? (V1_NETWORKS[rawNetwork] ?? rawNetwork) : null;
    const amount = str(a.amount) ?? str(a.maxAmountRequired);
    const asset = str(a.asset);
    const payTo = str(a.payTo);
    const timeout = typeof a.maxTimeoutSeconds === "number" ? a.maxTimeoutSeconds : null;
    const extra = a.extra && typeof a.extra === "object" ? (a.extra as Record<string, unknown>) : {};
    const isEvm = !!network && network.startsWith("eip155:");
    const usd = priceUsd(network, asset, amount);
    const known = network ? KNOWN_USDC[network] : undefined;
    const entry: Record<string, unknown> = {
      scheme,
      network,
      asset,
      assetLabel: known && asset && known.address.toLowerCase() === asset.toLowerCase() ? known.label : null,
      amountAtomic: amount,
      priceUsd: usd,
      payTo,
      payToKind: null,
      maxTimeoutSeconds: timeout,
      eip712: null,
    };
    outAccepts.push(entry);

    if (!scheme) add(`${p}.scheme`, "fail", `${p}: scheme is missing.`);
    else if (!KNOWN_SCHEMES.has(scheme)) add(`${p}.scheme`, "warn", `${p}: unfamiliar scheme "${short(scheme, 30)}"; many buyers support only exact.`);
    if (!network) add(`${p}.network`, "fail", `${p}: network is missing.`);
    if (!amount || !/^\d+$/.test(amount) || amount === "0") add(`${p}.amount`, "fail", `${p}: amount must be a positive integer in the asset's smallest unit (got ${amount ?? "nothing"}).`);
    if (!asset) add(`${p}.asset`, "fail", `${p}: asset is missing.`);
    if (timeout !== null && (timeout < 10 || timeout > 3600)) add(`${p}.timeout`, "warn", `${p}: maxTimeoutSeconds ${timeout} is unusual (most sellers use 60 to 300).`);

    if (!isEvm) {
      if (network) add(`${p}.network`, "info", `${p}: ${network} is not checked on-chain in this version.`);
      continue;
    }
    if (!payTo || !isAddress(payTo, { strict: false })) {
      add(`${p}.payTo`, "fail", `${p}: payTo is not a valid EVM address.`);
      continue;
    }
    if (/^0x0{40}$/i.test(payTo)) add(`${p}.payTo`, "fail", `${p}: payTo is the zero address; payments would be lost.`);
    if (asset && known && asset.toLowerCase() !== known.address.toLowerCase()) {
      add(`${p}.asset`, "warn", `${p}: asset ${asset} is not the native ${known.label}; check the token before paying.`);
    }

    const client = network ? opts.clients[network] : undefined;
    if (!client) {
      notMeasured.push({ item: `${p}.onchain`, reason: `${network} is not read on-chain in this version (Base and Base Sepolia only).` });
      continue;
    }
    // 受取先がコントラクトか（スマートウォレットなど）。情報として出す
    try {
      const code = await client.getCode({ address: getAddress(payTo) });
      // EIP-7702 で委任された普通のアドレスは 0xef0100 + 委任先 の23バイト
      entry.payToKind = !code || code === "0x" ? "eoa" : code.toLowerCase().startsWith("0xef0100") ? "eoa_7702_delegated" : "contract";
    } catch {
      notMeasured.push({ item: `${p}.payToKind`, reason: "RPC call failed." });
    }
    // EIP-712 名と extra の一致（exact の EIP-3009 で使う。permit2 は別の仕組み）
    const method712 = str(extra.assetTransferMethod);
    if (asset && isAddress(asset, { strict: false }) && method712 !== "permit2") {
      try {
        const onchain = await readEip712(client, getAddress(asset));
        const declared = { name: str(extra.name), version: str(extra.version) };
        const match =
          onchain.name !== null && onchain.version !== null && declared.name === onchain.name && declared.version === onchain.version;
        entry.eip712 = { declared, onchain: { name: onchain.name, version: onchain.version }, match };
        if (!declared.name || !declared.version) {
          add(`${p}.eip712`, "fail", `${p}: extra.name/extra.version missing; buyers cannot build the EIP-712 signature (token says "${onchain.name}" / "${onchain.version}").`);
        } else if (onchain.name === null || onchain.version === null) {
          add(`${p}.eip712`, "warn", `${p}: the token did not expose its EIP-712 name/version via ${onchain.source}.`);
        } else if (!match) {
          add(`${p}.eip712`, "fail", `${p}: extra says "${declared.name}" / "${declared.version}" but the token's EIP-712 domain is "${onchain.name}" / "${onchain.version}". Signatures will not verify.`);
        } else add(`${p}.eip712`, "pass", `${p}: extra.name/version match the token ("${onchain.name}" / "${onchain.version}").`);
      } catch {
        notMeasured.push({ item: `${p}.eip712`, reason: "RPC call failed." });
      }
    }
  }

  // 4. Bazaar（検索で見つけてもらうための情報）
  const ext = pr && pr.extensions && typeof pr.extensions === "object" ? (pr.extensions as Record<string, unknown>) : null;
  const bz = ext && ext.bazaar && typeof ext.bazaar === "object" ? (ext.bazaar as Record<string, unknown>) : null;
  const info = bz && bz.info && typeof bz.info === "object" ? (bz.info as Record<string, unknown>) : null;
  const bazaar = {
    present: !!bz,
    hasInputExample: !!(info && info.input),
    hasInputSchema: !!(bz && bz.schema),
    hasOutputExample: !!(info && info.output && typeof info.output === "object" && "example" in (info.output as object)),
  };
  if (pr && x402Version === 2) {
    if (!bazaar.present) add("bazaar", "warn", "No Bazaar discovery extension: the endpoint is hard to find by search.");
    else if (!bazaar.hasInputSchema || !bazaar.hasOutputExample) add("bazaar", "warn", "Bazaar extension lacks an input schema or output example; agents cannot tell how to call it.");
    else add("bazaar", "pass", "Bazaar extension has input and output information.");
  }

  const summary = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const c of checks) summary[c.status]++;
  const result =
    res.status !== 402 || !pr || accepts.length === 0
      ? "not_payable"
      : summary.fail > 0
        ? "has_problems"
        : summary.warn > 0
          ? "payable_with_warnings"
          : "payable";

  return {
    unreachable: false as const,
    body: {
      url: url.toString(),
      method,
      checkedAt,
      result,
      summary,
      http: httpInfo,
      x402: { version: x402Version, source: decoded.source },
      resource: { url: resourceUrl, description: description ? short(description, 600) : null, serviceName, tags },
      accepts: outAccepts,
      bazaar,
      checks,
      notMeasured,
      disclaimer:
        "One unpaid request; never signs or pays. Facts about the payment terms, not a judgment of the seller's honesty or the value of what it sells.",
    },
  };
}
