# AIエージェントの店（x402）v0.6

x402で情報を1回ごとに売る店です。商品ごとに有料APIを持ち、料金所・カタログ（Bazaar）登録・OpenSea（ERC-8257）のマニフェストは店の共通部分が受け持ちます。
企画・成績・判断の記録は Notion の「AIエージェントの店（x402）」にあります。

| 商品 | 有料API | 価格 | 状態 |
|---|---|---|---|
| Mint Check | `/api/mint-check` | 0.02 USDC | 販売中（Bazaar 掲載、OpenSea ツール番号933） |

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
| `lib/shop/facilitator-log.ts` | 決済の失敗時に詳細を Vercel のログへ（署名は書かない） |
| `lib/shop/types.ts` | 商品の型 |
| `lib/products/index.ts` | 商品の一覧 |
| `lib/products/mint-check/` | Mint Check の定義（`product.ts`）とチェック本体（`checks.ts`） |
| `app/api/<slug>/route.ts` | 商品ごとの有料API（3行） |
| `app/api/manifest/[slug]/route.ts` | マニフェスト |
| `app/api/products/route.ts` | 商品一覧 |
| `scripts/shop-test.ts` | 店全体の検査 |
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
| `BASE_RPC_URL` | 調査対象を読む RPC（空なら公開 RPC） |

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

「買うべき／避けるべき」は返しません。capabilities は**よくある関数名との一致による推定**です。独自の名前の関数は見つけられないので、`false` は「見つからなかった」という意味です。

## 変更履歴

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

- 型チェック、ビルド、全テストは通過済み。手元のサーバーで、配信されるマニフェストが登録時と同じバイト列であることを確認済み。
- 公開後に、本番の 402 応答と OpenSea の検証表示が変わっていないことを確認する。

## 既知の制約

- そのチェーンでまだ使われていないスマートウォレット（Base Account など）からの支払いは、練習用ファシリテーターに拒否されます（`eip6492_factory_not_allowed`）。買い手側がそのチェーンで一度取引をすれば通ります。
