/**
 * ダッシュボードのカードをどのセクションに置くかの方針。
 *
 * カードの性質はこれから増えるほどバラバラになる（計測値・操作ボタン・予定・稼働履歴）。
 * 最大幅 480px の2列グリッドに全部を混ぜると、行の高さも情報量も揃わず崩れるため、
 * 次の2点を方針として固定する。
 *
 * 1. カードは必ずどちらかのセクションに属する。
 *    - `sensors`（センサー）: センサー・屋外・エアコンなど、時系列グラフを持つ計測値。2列グリッド。
 *    - `life`（暮らし）: ゴミの日・照明の操作など、計測値ではないもの。1列で全幅。
 *      1行あたりの情報量がカードごとに大きく違い、2列に押し込むと読めなくなるため。
 *
 * 2. 並び順の設定（`display_order`）はグラフ凡例の並びと同じ設定なので、
 *    凡例を持たない `life` のカードは混ぜない。`life` のカードは LIFE_CARDS の定義順に並べる。
 *    表示・非表示だけは共通の `hidden_devices`（デバイス設定画面）で扱う。
 */

export type DashboardSection = "sensors" | "life";

export const DASHBOARD_SECTION_LABELS: Record<DashboardSection, string> = {
  sensors: "センサー",
  life: "暮らし",
};

/** 暮らしセクションのカード。ダッシュボードにはこの順で並ぶ */
export interface LifeCardDefinition {
  /** hidden_devices で使う表示・非表示キー */
  key: string;
  label: string;
}

export const GARBAGE_CARD_KEY = "garbage";

export const LIFE_CARDS: readonly LifeCardDefinition[] = [
  { key: GARBAGE_CARD_KEY, label: "ゴミの日" },
];

export function getLifeCardLabel(key: string): string {
  return LIFE_CARDS.find((card) => card.key === key)?.label ?? key;
}
