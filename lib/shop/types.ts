/**
 * 店に並べる「商品」の型。
 * 新しい商品は lib/products/<slug>/product.ts でこの型のオブジェクトを作り、
 * lib/products/index.ts の一覧に足す。料金所・カタログ登録・OpenSea のマニフェストは店の共通部分が受け持つ。
 */

/** 商品の処理結果。status が 400 以上なら課金されない */
export type ProductResult = { status: number; body: unknown };

/** 入力: GET のクエリ、または POST の JSON 本文から読んだ値（文字列に揃える） */
export type ProductInput = Record<string, string | null>;

type JsonSchemaObject = {
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
};

export interface Product {
  /** URL に使う名前。英小文字・数字・ハイフン。OpenSea のスラッグ（表示名から作る）と一致させる */
  slug: string;
  /** カタログの表示名（ASCII・32文字以内） */
  serviceName: string;
  /** カタログの説明（500文字以内。CDP が超過を拒否する） */
  description: string;
  /** 検索タグ（ASCII・各32文字以内・最大5個） */
  tags: string[];
  /** 1回の価格。"$0.02" の形 */
  price: () => string;

  /** Bazaar 用: 入力例・入力の形・出力例 */
  bazaar: {
    inputExample: Record<string, unknown>;
    inputSchema: JsonSchemaObject;
    outputExample: Record<string, unknown>;
  };

  /** OpenSea（ERC-8257）用 */
  manifest: {
    /** 中身を変えたら上げる。変えるとオンチェーンの記録の更新が要る */
    version: string;
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
  };

  /** 支払い済みの呼び出しで実行する本体 */
  run: (input: ProductInput) => Promise<ProductResult>;
}

export function productPath(product: Pick<Product, "slug">): string {
  return `/api/${product.slug}`;
}
