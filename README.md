# AIエージェントの店（x402）v0.11

x402で情報を1回ごとに売る店です。商品ごとに有料APIを持ち、料金所・カタログ（Bazaar）登録・OpenSea（ERC-8257）のマニフェストは店の共通部分が受け持ちます。
企画・成績・判断の記録は Notion の「AIエージェントの店（x402）」にあります。

| 商品 | 有料API | 価格 | 状態 |
|---|---|---|---|
| Mint Check | `/api/mint-check` | 0.02 USDC | 販売中（Bazaar 掲載、OpenSea ツール番号933） |
| x402 Seller Check | `/api/x402-seller-check` | 0.01 USDC | 販売中（2026-11-19 公開、Bazaar 掲載、OpenSea ツール番号945） |
| Tokenized Stock Check | `/api/tokenized-stock-check` | 0.01 USDC | 販売中（2026-11-21 公開、OpenSea ツール番号946） |

無料のページ:

- `/api/products` … 商品の一覧（名前・説明・価格・マニフェストの場所）
- `/.well-known/ai-tool/<slug>.json` … OpenSea 用のマニフェスト

## 商品の呼び方

```
GET  /api/<slug>?key=value
POST /api/<slug>   本文 {"key":"value"}
```

支払いなしで呼ぶと 402 と値段が返ります。商品がエラー（400番台以上）を返したときは課金されません。

## 新しい商品の足し方

```bash
npm run new-product -- holder-check "Holder Check"   # slug と、表示名から作るスラッグを一致させる
# lib/products/holder-check/product.ts の TODO と run を書く
npm test                                             # 全商品の検査
```

ひな形の本体は「未実装（501、課金なし）」を返します。中身を書くまで公開しないでください。

検査（`npm test`）が確かめること:

- 説明文が500文字以内（CDP が超過を拒否する）、表示名とタグがカタログの条件を満たす
- マニフェストが OpenSea 公式の検証に通る、slug と OpenSea のスラッグが一致する
- 支払いなしの GET・POST に 402 を返し、表示名・タグ・説明・価格が載る
- **Mint Check の出力が OpenSea 登録時から1文字も変わっていない**（`scripts/fixtures/mint-check-v0.5.json` と照合）

## 公開済み商品を変えるときの注意

説明・タグ・入出力・価格、環境変数の `PAY_TO`・`X402_NETWORK`・`PRICE` はマニフェストに含まれ、そのハッシュが OpenSea に記録されています。変えると OpenSea の検証表示が外れるので、`manifest.version` を上げ、オンチェーンの記録も更新してください。Mint Check の場合は検査が失敗して知らせます。

## 構成

| ファイル | 役割 |
|---|---|
| `lib/shop/payment.ts` | 料金所（ネットワーク・ファシリテーターの切り替え）。全商品で共有 |
| `lib/shop/catalog.ts` | Bazaar 用のルート設定、OpenSea 用のマニフェスト |
| `lib/shop/paid-route.ts` | 商品1つ分の有料API（GET・POST の入力読み取りを含む） |
| `lib/shop/sales-log.ts` | 決済が成立するたびに Notion の売上記録へ1行書く（客への返事のあと） |
| `lib/shop/facilitator-log.ts` | 決済の失敗時に詳細を Vercel のログへ（署名は書かない） |
| `lib/shop/types.ts` | 商品の型 |
| `lib/products/index.ts` | 商品の一覧 |
| `lib/products/mint-check/` | Mint Check の定義（`product.ts`）とチェック本体（`checks.ts`） |
| `app/api/<slug>/route.ts` | 商品ごとの有料API（3行） |
| `app/api/manifest/[slug]/route.ts` | マニフェスト |
| `app/api/products/route.ts` | 商品一覧 |
| `scripts/shop-test.ts` | 店全体の検査 |
| `scripts/sales-test.ts` | 売上の記録の検査（決済の流れの中で1件書くこと、Notion が落ちても販売は成功すること） |
| `scripts/selftest.ts` | Mint Check のチェック本体の検査（通信なし） |
| `scripts/log-test.ts` | 失敗ログに署名が出ないことの検査 |
| `scripts/new-product.ts` | 新しい商品のひな形 |
| `scripts/check.ts` | Mint Check を支払いなしで試す（`npm run check -- 0x...`） |

## 環境変数（Vercel）

| 名前 | 内容 |
|---|---|
| `PAY_TO` | 売上を受け取るアドレス（必須） |
| `X402_NETWORK` | `eip155:8453`（本番）か `eip155:84532`（練習用） |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Coinbase のファシリテーター。本番では必須。値はチャットや GitHub に載せない |
| `PRICE` | Mint Check の価格（未設定なら $0.02） |
| `NOTION_TOKEN` | 売上の記録用の Notion のキー。入れると決済ごとに「売上記録」へ1行書く。値はチャットや GitHub に載せない |
| `NOTION_SALES_DATA_SOURCE_ID` | 売上記録の data source ID（空なら既定値） |
| `OWNER_ADDRESS` | 運営者自身の購入アドレス（空なら既定値）。この購入は区分「運営者」になる |
| `BASE_RPC_URL` | 調査対象を読む RPC（空なら公開 RPC） |
| `BASE_SEPOLIA_RPC_URL` | x402 Seller Check が Base Sepolia の資産を読む RPC（空なら公開 RPC） |
| `SELLER_CHECK_PRICE` | x402 Seller Check の価格（未設定なら $0.01） |

## Mint Check の中身

Base の NFT コントラクトを、ミントや購入の前に調べます。`tokenId` は任意で、ERC-1155 の発行数を読むときに指定します。

### 返すもの

| 項目 | 内容 |
|---|---|
| basics | NFTの規格（ERC-721／1155）、名前、作成者 |
| code | ソースが公開・検証済みか、中身を差し替えられる作り（プロキシ）か |
| control | オーナーは誰か。単独の鍵／コントラクト／放棄済み。Safe（複数人管理）なら「何人中何人の承認が必要か」 |
| mint | 現在の発行数、上限（ERC-1155 は tokenId 指定時）、既知の型（SeaDrop・thirdweb）に一致するか |
| capabilities | 画像の差し替え、発行数や価格の変更、停止、引き出し、追加発行の関数があるか |
| flags | 上の結果から立った注意点 |
| notMeasured | 測れなかった項目とその理由 |
| capabilities.metadata（v0.9） | 画像（メタデータ）の置き場所（onchain_data／ipfs／arweave／web）と凍結済みか |
| control.royalty（v0.9） | ERC-2981 のロイヤルティ受取人（単独の鍵かコントラクトか）と率。`capabilities.canChangeRoyalty` で変更関数の有無 |
| control.roles（v0.9） | AccessControl の権限（DEFAULT_ADMIN／MINTER／METADATA／PAUSER）の持ち主。列挙できる場合のみ最大5人 |
| mint.insiderHoldings（v0.9） | オーナー・作成者が持っている枚数と、発行数に対する割合 |

「買うべき／避けるべき」は返しません。capabilities は**よくある関数名との一致による推定**です。独自の名前の関数は見つけられないので、`false` は「見つからなかった」という意味です。

## x402 Seller Check の中身

知らない x402 の店に払う前の点検です。`url`（https、ポート443）と任意の `method`（GET／POST）を受け取り、**支払いなしで1回だけ**呼んで 402 を解読します。署名も支払いもしません。

| 点検 | 内容 |
|---|---|
| answers_402 | 支払いなしで 402 を返すか（200・リダイレクト・404 などは失敗） |
| x402_version | v2（PAYMENT-REQUIRED ヘッダー）か v1（本文）か |
| resource_url | 宣言された URL が、呼んだ公開 https の URL と同じか |
| description | 説明文が CDP の上限 500 文字以内か（超えると支払いの検証で拒否される） |
| accepts[n] | 方式・ネットワーク・金額・資産・受取先・待ち時間。既知の USDC なら USD 換算 |
| accepts[n].eip712 | `extra.name/version` がトークンの EIP-712 名と一致するか（Base と Base Sepolia で実際に読む） |
| payToKind | 受取先が普通のアドレス／EIP-7702 委任／コントラクトか |
| bazaar | 検索に載るための入出力の情報があるか |

`result` は `payable`／`payable_with_warnings`／`has_problems`／`not_payable` のどれかです。店の誠実さや商品の価値は判定しません。払った後に何が届くかは測れないので `notMeasured` に書きます。

安全のため、内部・予約済みアドレスに解決するホスト、443以外のポート、http は呼びません。リダイレクトは追いません。待つのは8秒、読むのは64KBまでです。

## Tokenized Stock Check の中身

Base のトークン化米国株のアドレス（`address`）を受け取り、発行元の仕組みに合わせて読みます。この版は Coinbase（B20）と Dinari（dShares）に対応し、それ以外は `issuer: "unknown"` を返します。

| 発行元 | 読むもの |
|---|---|
| Coinbase（B20） | 停止中の機能（TRANSFER／MINT／BURN／SEIZE）、送金ポリシー（ブロックリストか許可リストか、管理者が単独の鍵か）、没収の設定、発行上限、配当の倍率、Chainlink の価格と更新からの経過時間 |
| Dinari | 停止中か、送金制限（ブラックリスト）、ビーコンによる一括差し替えと、その権限者が単独の鍵か、1トークンあたりの株数 |
| 共通 | いま米国市場（NY 月〜金 9:30〜16:00）が開いているか。祝日は見ない |

B20 の役割（発行・停止・没収の担当者）はチェーン上で列挙できないので `notMeasured` に書きます。Dinari にはオンチェーンの価格フィードがありません。

## 売上の記録

決済が成立するたびに、API自身が Notion の「売上記録」に1行書きます（日時・商品・購入者・区分・金額・取引）。Bazaar の統計の更新を待たずに売上を把握できます。

- 書き込みは客への返事のあとで行うので、販売の速さは変わりません。
- Notion に書けなかったときも販売は成功のままで、Vercel のログに `[sales-log]` として残ります。
- `NOTION_TOKEN` が空なら何もしません。

## 変更履歴

### v0.11（2026-11-21）

- Tokenized Stock Check: 価格フィードの時間を修正。Chainlink の株価フィードは日曜20:00〜金曜20:00（NY）に時間外も含めて動くので、価格が止まるのは週末だけ。`market` に `feedWindowOpen` と `session`（regular／extended／weekend）を出し、`US_MARKET_CLOSED` を `PRICE_FEED_FROZEN_WEEKEND` に置き換え。送る側と受け取る側が同じポリシーのとき注意を1回にまとめた。説明文・マニフェストは不変。
- 商品一覧を x402 の検索サービス向けに公開: `/openapi.json`（各操作に `x-payment-info` と 402 応答）と `/.well-known/x402`。`PRODUCTS` から自動生成（`lib/shop/discovery.ts`、テスト `scripts/discovery-test.ts`）。

### v0.10（2026-11-20）

- 3号商品 Tokenized Stock Check を公開し、OpenSea にツール番号946で登録（ハッシュ 0x10f6f061…bc47）。試作（`lib/products/tokenized-stock-check/`、テスト `scripts/stock-check-test.ts`）。読み方は NVDAc と Dinari AAPL でチェーン上で確かめた。既存2商品の出力・マニフェストは変更なし。

### v0.9（2026-11-20）

- 本番の試し買い（Quacked Ops）で、公開RPCに読み取りを断られ保有枚数などが空になる問題を見つけて修正。コードにある関数だけ問い合わせ、大事な読み取りは1回やり直す。
- Mint Check に4つの点検を追加（`lib/products/mint-check/extras.ts`）。Surf の「2026年のBaseの手口」調査で、未対応だった項目を埋めた。新しい注意フラグ: `METADATA_ON_WEB_SERVER`・`ROYALTY_CHANGEABLE`・`ROLE_HELD_BY_SINGLE_KEY`・`ROLES_REMAIN_AFTER_RENOUNCE`・`INSIDERS_HOLD_LARGE_SHARE`。
- 返す中身に足しただけで、説明文・マニフェスト・Bazaar の例は変えていない。OpenSea のハッシュ（ツール番号933）はそのまま有効（ゴールデンテストで確認）。

### v0.8（2026-11-19）

- 2号商品 x402 Seller Check を追加し公開。OpenSea にツール番号945で登録（マニフェストのハッシュ 0xfa1935d1…11e5）（`lib/products/x402-seller-check/`）。Mint Check の説明・価格・マニフェストは変更なし（ゴールデンテストで確認）。
- テスト `scripts/seller-check-test.ts` を追加。Mint Check の本物の 402、実在の店から支払いなしで取得した条件、Mint Check 開発中に実際に起きた失敗（説明文 500 文字超、EIP-712 名の不一致）を再現して確かめる。

### v0.7（2026-11-18）

- 売上の記録を追加。決済が成立するたびに Notion の「売上記録」へ1行書く（`lib/shop/sales-log.ts`）。`NOTION_TOKEN` を入れると動き始める。
- 検査 `scripts/sales-test.ts` を追加し、`npm test` に含めた。Mint Check の出力（マニフェスト・402応答）は v0.5 から変わっていない。

### v0.6（2026-11-18）

- 店を「複数の商品を置ける店」に作り替えた。料金所・カタログ登録・マニフェストを共通部分（`lib/shop/`）にまとめ、商品は `lib/products/<slug>/` に置く形にした。
- Mint Check の出力（マニフェスト・Bazaar のルート設定・402 応答）が v0.5 と1文字も変わっていないことを検査で確認。マニフェストのハッシュは OpenSea 登録時の値（`0x16eb240c…`）のまま。
- 無料の商品一覧 `/api/products` を追加。マニフェストの場所を商品ごと（`/.well-known/ai-tool/<slug>.json`）にした。
- 新しい商品のひな形を作る `npm run new-product` と、全商品をまとめて検査する `npm test` を追加。

### v0.5（2026-11-16）

- OpenSea（ERC-8257）用のマニフェストを `/.well-known/ai-tool/mint-check.json` で公開するようにした。OpenSea 公式 SDK の検証に通ることを確認済み。
- POST（JSON 本文）でも呼べるようにした。支払いなしの POST にも402を返すことを確認済み。
- テスト用に `@opensea/tool-sdk` を開発用の依存に追加した（本番の動作には使わない）。

### v0.4（2026-11-16）

- カタログ用の表示名「Mint Check」と検索タグ5個（nft, pre-mint-check, contract-risk, base, rug-check）を追加した。
- ルートをパス付き（`/api/mint-check`）で登録するようにし、ログのワイルドカード警告をなくした。
- 402応答に表示名・タグが載ることを、代役のファシリテーターで確かめるテストを追加した（`scripts/route-test.ts`）。
- 2026-11-16 に Base 本番で初の決済（0.02 USDC、自分で購入）を確認。

### v0.3.2（2026-11-16）

- CDPに拒否された原因は、カタログ用の説明文が506文字で、CDPの上限（500文字）を超えていたこと。401文字に短縮した。
- 説明文が500文字を超えたら `scripts/config-test.ts` が失敗するようにした。

### v0.3.1（2026-11-16）

- ファシリテーターとのやり取りが失敗したとき、Vercel のログに `[facilitator-error]` として詳細を書き出すようにした。署名と認証ヘッダーは書き出さない。
- CDP経由の練習用購入は、支払いの形式が合わないという理由で拒否された（課金なし）。

### v0.3（2026-11-16）

- CDPのAPIキーを環境変数に入れると、Coinbaseのファシリテーターに自動で切り替わるようにした。
- 本番ネットワークで練習用ファシリテーターを指定した場合は、エラーにして課金しないようにした。
- 実機確認: Safeの内訳（4人中2人）が読めた。トークン番号1の発行数は、対象コントラクトに番号ごとの発行数を返す関数がなく読めなかった（`notMeasured` に記載される）。

### v0.2（2026-11-16）

- ERC-1155 の発行数を `tokenId` 指定で読めるようにした。
- 名前・シンボルが読めないとき、`notMeasured` に載せるようにした。
- オーナーが Safe のとき、承認に必要な人数と管理者の人数を返すようにした（`control.multisig`）。

### v0.1（2026-11-15）

- 最初の版。Base Sepolia で、支払いから結果の受け取りまで確認済み（2026-11-16）。

## この版の確認状況

- 型チェック、ビルド、全テストは通過済み。Mint Check のマニフェスト・402 は登録時と同じ（ゴールデンテスト）。
- x402 Seller Check の外への接続（実際の https 呼び出し）は、作業環境から外に出られないため本番で確認する。
- 公開後に、本番の 402 応答と OpenSea の検証表示が変わっていないことを確認する。

## 既知の制約

- そのチェーンでまだ使われていないスマートウォレット（Base Account など）からの支払いは、練習用ファシリテーターに拒否されます（`eip6492_factory_not_allowed`）。買い手側がそのチェーンで一度取引をすれば通ります。
