/**
 * ダッシュボードのカードをどのセクションに置くかの方針。
 *
 * カードの性質はこれから増えるほどバラバラになる（計測値・操作ボタン・予定・稼働履歴）。
 * スマホ（最大幅 480px）の2列グリッドに全部を混ぜると、行の高さも情報量も揃わず崩れるため、
 * 次の3点を方針として固定する。
 *
 * 1. カードは必ずどれかのセクションに属する。
 *    - `life`（暮らし）: ゴミの日・照明の操作など、計測値ではないもの。1列で全幅。
 *      1行あたりの情報量がカードごとに大きく違い、2列に押し込むと読めなくなるため。
 *    - `sensors`（センサー）: センサー・屋外・エアコンなど、時系列グラフを持つ計測値。2列グリッド。
 *    - `comingSoon`（近日公開）: まだ作っていない機能の案内。押しても何も起きない。
 *
 * 2. 並び順の設定（`display_order`）はグラフ凡例の並びと同じ設定なので、
 *    凡例を持たない `life` のカードは混ぜない。`life` のカードは LIFE_CARDS の定義順に並べる。
 *    表示・非表示だけは共通の `hidden_devices`（デバイス設定画面）で扱う。
 *
 * 3. 画面上の並びは「暮らし → センサー → 推移（グラフ）→ 最近の記録 → 近日公開」。
 *    朝いちばんに知りたい予定を先頭に置き、時系列グラフは掘り下げる情報として下へ回す。
 *    PC（1024px以上）では左に計測値（センサー・推移・最近の記録）、右に暮らし・近日公開を置く。
 */

export type DashboardSection = "sensors" | "life" | "comingSoon";

export const DASHBOARD_SECTION_LABELS: Record<DashboardSection, string> = {
  sensors: "センサー",
  life: "暮らし",
  comingSoon: "近日公開",
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

/**
 * 近日公開セクションのカード。実装が済んだものはここから消し、
 * `LIFE_CARDS` か `sensors` の本物のカードに置き換える。
 */
export interface ComingSoonCardDefinition {
  key: string;
  label: string;
  /** 「何ができるようになるか」を利用者の言葉で1行 */
  description: string;
}

/** 近日公開セクション全体の表示・非表示キー（カード単位では切り替えない） */
export const COMING_SOON_SECTION_KEY = "coming-soon";

export const COMING_SOON_CARDS: readonly ComingSoonCardDefinition[] = [
  {
    key: "cleaner",
    label: "お掃除ロボット",
    description: "稼働した日と時間を記録して並べます",
  },
  {
    key: "power",
    label: "消費電力",
    description: "スマートプラグごとの使用量をグラフにします",
  },
  {
    key: "remote",
    label: "電気の操作",
    description: "照明やエアコンをこの画面から操作します",
  },
  {
    key: "aircon-cost",
    label: "エアコンの電気代",
    description: "今月ぶんの目安を出します",
  },
];
