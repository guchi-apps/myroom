import { LIFE_CARDS, type LifeCardDefinition } from "@/lib/dashboard-sections";
import { moveOrderItem, normalizeOrderKeys, reorderItems } from "@/lib/ordering";

/**
 * 「暮らし」のカードを並べる順（#283）。
 *
 * 保存するのはキーの配列だけで、**どのカードが存在するかの正は `LIFE_CARDS`**。
 * バックエンド（`app_settings` の `life_card_order`）は文字列の配列としてしか見ておらず、
 * 消えたキーを捨てて足りないキーを補うのはここの仕事。カードを1枚増やしたときに
 * 「保存済みの順番を持っている人にだけ新しいカードが出ない」という形にならないよう、
 * 知らないキーは落とし、`LIFE_CARDS` にあって並びに無いキーは末尾へ足す。
 *
 * **整える規則そのものは `lib/ordering.ts` と共有する。** 「いまの環境」の並び替え
 * （`lib/display-order.ts`）と同じ仕様なので、ここには暮らし固有の既定値だけを置く。
 */

export function buildDefaultLifeCardOrder(): string[] {
  return LIFE_CARDS.map((card) => card.key);
}

export function normalizeLifeCardOrder(
  saved: readonly string[] | null | undefined
): string[] {
  return normalizeOrderKeys(saved, buildDefaultLifeCardOrder());
}

/** 並び順のキーを、そのままカードの定義へ引き直す */
export function getOrderedLifeCards(
  order: readonly string[]
): LifeCardDefinition[] {
  return normalizeLifeCardOrder(order)
    .map((key) => LIFE_CARDS.find((card) => card.key === key))
    .filter((card): card is LifeCardDefinition => card != null);
}

/** 隣と入れ替える（スマホの上下ボタン） */
export function moveLifeCardOrderItem(
  order: readonly string[],
  index: number,
  direction: -1 | 1
): string[] {
  return moveOrderItem(order, index, direction);
}

/** 抜いて差し込む（PCのドラッグ） */
export function reorderLifeCards(
  order: readonly string[],
  fromIndex: number,
  toIndex: number
): string[] {
  return reorderItems(order, fromIndex, toIndex);
}
