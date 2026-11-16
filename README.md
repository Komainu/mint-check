# Mint Check（v0.5）

BaseのNFTコントラクトを、ミントや購入の前に調べる有料APIです。x402で1回ごとに課金します。
この版は**練習用ネットワーク（Base Sepolia）で課金**するので、本物のお金は動きません。調べる対象はBase本番のコントラクトです。

```
GET /api/mint-check?address=0x調べたいコントラクト
GET /api/mint-check?address=0x調べたいコントラクト&tokenId=1
POST /api/mint-check   本文 {"address":"0x調べたいコントラクト","tokenId":"1"}
```

POST は OpenSea のツール一覧（ERC-8257）から呼ぶエージェント向けです。価格と中身は GET と同じです。

`tokenId` は任意です。ERC-1155 は発行数をトークン番号ごとに持つので、発行数を読みたいときに指定します。

## 返すもの

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

## 手順

### 1. 手元でチェック本体だけ試す（支払いなし）

```bash
npm install
npm run check -- 0x調べたいコントラクト
npm run check -- 0x調べたいコントラクト 1   # ERC-1155 でトークン番号1の発行数も読む
```

結果のJSONが出れば、チェック本体は動いています。

### 2. Vercelに公開する

1. このフォルダをGitHubのリポジトリに上げ、Vercelで「New Project」から取り込む。
2. Vercelの「Environment Variables」に次を入れる（`.env.example` と同じ内容）。
   - `PAY_TO` … 売上を受け取る自分のアドレス（必須）
   - `X402_NETWORK` … `eip155:84532`
   - `FACILITATOR_URL` … `https://x402.org/facilitator`
   - `PRICE` … `$0.02`
3. デプロイする。

### 3. 料金所が動いているか確かめる

ブラウザで `https://あなたのドメイン/api/mint-check?address=0x...` を開きます。
**「402 Payment Required」と値段の情報が返れば成功**です。支払っていないので、結果は返りません。

### 4. 自分で買ってみる

Base Sepolia のテスト用USDCを持ったウォレットから、x402に対応した買い手（Base MCPなど）でこのURLを呼びます。
支払いが通って結果のJSONが返れば、フェーズ0は完了です。
テスト用USDCはCoinbase Developer PlatformのFaucetで無料でもらえます。

## 本番への切り替え（2段階）

コードは変えず、Vercelの環境変数だけで切り替えます。CDPのAPIキーの値は**Vercelの環境変数にだけ**入れ、チャットやGitHubには載せないでください。

### 段階A: 練習用ネットワークのまま、CDPのファシリテーターに切り替える

1. Vercelの環境変数に `CDP_API_KEY_ID` と `CDP_API_KEY_SECRET` を追加する（`X402_NETWORK` は `eip155:84532` のまま）。
2. 再デプロイし、もう一度テスト用USDCで1回買う。
3. 結果が返れば、CDPの認証は通っています。失敗してもテスト用のお金しか動きません。

### 段階B: 本番に切り替える

1. `X402_NETWORK` を `eip155:8453` に変える。
2. 再デプロイし、本物のUSDCで1回（0.02ドル）買う。
3. 決済が通ると、Bazaar（カタログ）に自動で載ります。説明文と入出力の例は `lib/x402.ts` にあります。

本番でCDPのキーが空のままだと、起動時にエラーを返して課金しないようにしてあります。

## OpenSea（ERC-8257）への掲載

- マニフェストを `https://mint-check.vercel.app/.well-known/ai-tool/mint-check.json` で公開しています（`lib/manifest.ts`）。
- 登録は Base Account から、OpenSea のツール登録コントラクトへの取引で行います（次の作業）。
- **登録後にマニフェストの中身を変えたら、オンチェーンの記録も更新が必要です。** 環境変数の `PAY_TO`・`X402_NETWORK`・`PRICE` もマニフェストに含まれるので、変えるときは要注意です。

## ファイル

| ファイル | 役割 |
|---|---|
| `lib/checks.ts` | チェック本体 |
| `lib/x402.ts` | 料金所の設定とカタログ用の説明 |
| `lib/manifest.ts` | OpenSea（ERC-8257）用のマニフェスト |
| `lib/input.ts` | GET のクエリ・POST の JSON 本文から入力を読む |
| `app/api/manifest/route.ts` | マニフェストを返す（無料） |
| `app/api/mint-check/route.ts` | 有料API |
| `scripts/check.ts` | 支払いなしで試すコマンド |
| `scripts/selftest.ts` | 通信なしの簡易テスト（`npx tsx scripts/selftest.ts`） |
| `scripts/log-test.ts` | 失敗ログに署名が出ないことのテスト |
| `scripts/manifest-test.ts` | マニフェストを OpenSea 公式の検証関数で確かめるテスト |
| `scripts/route-test.ts` | 402応答に表示名・タグ・パスが載るかのテスト |
| `scripts/config-test.ts` | 環境変数ごとの料金所の設定テスト（`npx tsx scripts/config-test.ts`） |

## 変更履歴

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

- 型チェック、ビルド、通信なしの簡易テスト（30項目）は通過済み。
- Base 本番・CDP のファシリテーターでの支払いは確認済み（2026-11-16）。
- 表示名とタグがBazaarに反映されるかは、公開後に確認が必要。

## 既知の制約

- そのチェーンでまだ使われていないスマートウォレット（Base Account など）からの支払いは、練習用ファシリテーターに拒否されます（`eip6492_factory_not_allowed`）。買い手側がそのチェーンで一度取引をすれば通ります。
