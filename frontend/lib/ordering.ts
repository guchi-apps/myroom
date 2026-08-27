/**
 * 並び替えの共通処理（#283）。
 *
 * このアプリには並び替えが2か所ある。「いまの環境」のセンサー・屋外・エアコン
 * （`lib/display-order.ts`）と、「暮らし」のカード（`lib/life-card-order.ts`）で、
 * どちらも「未知のキーを捨て、欠けた既定を末尾へ足す」「隣と入れ替える」
 * 「抜いて差し込む」の3つを同じ仕様で必要とする。**片方だけ直すと、同じアプリの中に
 * 2種類の並び替えができる**ため、ここに1つだけ置いて両方から使う。
 */

/**
 * 保存された並びを既定の一覧に照らして整える。
 *
 * - 既定に無いキー（消したカード・入れ替えたデバイス）は落とす
 * - 重複は先に出てきた方を残す
 * - 既定にあって保存されていないキー（あとから増えたもの）は末尾へ足す
 */
export function normalizeOrderKeys(
  saved: readonly string[] | null | undefined,
  defaults: readonly string[]
): string[] {
  if (!saved?.length) return [...defaults];

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

/** 隣と入れ替える（スマホの上下ボタン）。端では動かさない */
export function moveOrderItem<T>(
  items: readonly T[],
  index: number,
  direction: -1 | 1
): T[] {
  const nextIndex = index + direction;
  if (index < 0 || index >= items.length) return [...items];
  if (nextIndex < 0 || nextIndex >= items.length) return [...items];

  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

/** 抜いて差し込む（PCのドラッグ） */
export function reorderItems<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  if (fromIndex === toIndex) return [...items];
  if (fromIndex < 0 || fromIndex >= items.length) return [...items];
  if (toIndex < 0 || toIndex >= items.length) return [...items];

  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
