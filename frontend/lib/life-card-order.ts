import { LIFE_CARDS, type LifeCardDefinition } from "@/lib/dashboard-sections";

/**
 * 「暮らし」のカードを並べる順（#283）。
 *
 * 保存するのはキーの配列だけで、**どのカードが存在するかの正は `LIFE_CARDS`**。
 * バックエンド（`app_settings` の `life_card_order`）は文字列の配列としてしか見ておらず、
 * 消えたキーを捨てて足りないキーを補うのはここの仕事。カードを1枚増やしたときに
 * 「保存済みの順番を持っている人にだけ新しいカードが出ない」という形にならないよう、
 * 知らないキーは落とし、`LIFE_CARDS` にあって並びに無いキーは末尾へ足す。
 */

export function buildDefaultLifeCardOrder(): string[] {
  return LIFE_CARDS.map((card) => card.key);
}

export function normalizeLifeCardOrder(
  saved: readonly string[] | null | undefined
): string[] {
  const defaults = buildDefaultLifeCardOrder();
  if (!saved?.length) return defaults;

  const known = new Set(defaults);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const key of saved) {
    if (typeof key !== "string") continue;
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }

  for (const key of defaults) {
    if (!seen.has(key)) normalized.push(key);
  }

  return normalized;
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
  const nextIndex = index + direction;
  if (index < 0 || index >= order.length) return [...order];
  if (nextIndex < 0 || nextIndex >= order.length) return [...order];

  const next = [...order];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

/** 抜いて差し込む（PCのドラッグ） */
export function reorderLifeCards(
  order: readonly string[],
  fromIndex: number,
  toIndex: number
): string[] {
  if (fromIndex === toIndex) return [...order];
  if (fromIndex < 0 || fromIndex >= order.length) return [...order];
  if (toIndex < 0 || toIndex >= order.length) return [...order];

  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
