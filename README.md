# Mint Check（フェーズ0）

BaseのNFTコントラクトを、ミントや購入の前に調べる有料APIです。x402で1回ごとに課金します。
この版は**練習用ネットワーク（Base Sepolia）で課金**するので、本物のお金は動きません。調べる対象はBase本番のコントラクトです。

```
GET /api/mint-check?address=0x調べたいコントラクト
```

## 返すもの

| 項目 | 内容 |
|---|---|
| basics | NFTの規格（ERC-721／1155）、名前、作成者 |
| code | ソースが公開・検証済みか、中身を差し替えられる作り（プロキシ）か |
| control | オーナーは誰か。単独の鍵／コントラクト（複数人管理など）／放棄済み |
| mint | 現在の発行数、上限、既知の型（SeaDrop・thirdweb）に一致するか |
| capabilities | 画像の差し替え、発行数や価格の変更、停止、引き出し、追加発行の関数があるか |
| flags | 上の結果から立った注意点 |
| notMeasured | 測れなかった項目とその理由 |

「買うべき／避けるべき」は返しません。capabilities は**よくある関数名との一致による推定**です。独自の名前の関数は見つけられないので、`false` は「見つからなかった」という意味です。

## 手順

### 1. 手元でチェック本体だけ試す（支払いなし）

```bash
npm install
npm run check -- 0x調べたいコントラクト
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

## 本番（フェーズ1）への切り替え

環境変数を変えるだけです。コードは変えません。

- `X402_NETWORK` を `eip155:8453`（Base本番）にする。
- `FACILITATOR_URL` を本番対応のファシリテーターにする。`x402.org` のものは練習用ネットワーク専用です。Coinbase（CDP）のファシリテーターを使う場合はAPIキーの設定が追加で必要になり、`lib/x402.ts` に認証を足します。
- 本番で1回決済が通ると、Bazaar（カタログ）に自動で載ります。説明文と入出力の例は `lib/x402.ts` にあります。

## ファイル

| ファイル | 役割 |
|---|---|
| `lib/checks.ts` | チェック本体 |
| `lib/x402.ts` | 料金所の設定とカタログ用の説明 |
| `app/api/mint-check/route.ts` | 有料API |
| `scripts/check.ts` | 支払いなしで試すコマンド |
| `scripts/selftest.ts` | 通信なしの簡易テスト（`npx tsx scripts/selftest.ts`） |

## この版の確認状況

- 型チェック、ビルド、通信なしの簡易テスト（15項目）は通過済み。
- **実際のBaseのコントラクトに対する動作と、実際の支払いは未確認**です。手順1と手順3・4が最初の確認になります。
