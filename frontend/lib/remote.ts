/**
 * 「電気の操作」カードの型と、押した結果の文言。
 *
 * 状態（照明が点いているか）は持たない。赤外線は片方向で機器から返事が来ないため、
 * 分かるのは「Nature Remo が送信を受け付けたところまで」だけ。文言もそこで止める（#106）。
 */

export interface RemoteButton {
  id: string;
  /** 画面に出す名前。付けた名前があればそれ、無ければ remote.json の名前 */
  label: string;
  /** remote.json に書かれている元の名前。設定画面で「もとの名前」として出す */
  default_label?: string;
  /** ダッシュボードに出さない指定。一覧には残るので設定画面からは戻せる */
  hidden?: boolean;
}

/** ボタン1つぶんの上書き。UI設定の `remote_buttons` に入る（#260） */
export interface RemoteButtonSetting {
  label?: string;
  hidden?: boolean;
  /**
   * 保存した時点で remote.json に書かれていた名前。
   *
   * ボタンIDは remote.json 側で `id` を省くと並び順から採番されるため、あとから
   * ボタンを挿すと設定が別のボタンへずれる。バックエンドはこの値が今の名前と
   * 食い違う設定を無視して、ずれたまま反映されるのを防ぐ。
   */
  default_label?: string;
}

export interface RemoteGroup {
  id: string;
  name: string;
  buttons: RemoteButton[];
}

export interface RemoteButtons {
  configured: boolean;
  groups: RemoteGroup[];
}

export interface RemoteSendResult {
  sent: boolean;
  button_id: string;
  label: string;
  group_name: string;
}

/** 押したボタンの見た目。1枚のカードで同時に1つしか進行しない */
export type RemoteSendStatus = "sending" | "sent" | "failed";

export interface RemoteFeedback {
  buttonId: string;
  status: RemoteSendStatus;
  /** 送信後に出す1行。"sending" のあいだは空 */
  message?: string;
}

/** 成功メッセージが出ている時間。長いと次の操作の邪魔になる */
export const REMOTE_SENT_MESSAGE_MS = 3000;

/** ボタンに付けられる名前の長さ。バックエンドの MAX_REMOTE_LABEL_LENGTH と揃える */
export const REMOTE_LABEL_MAX_LENGTH = 20;

export function countRemoteButtons(buttons: RemoteButtons | null): number {
  if (!buttons) return 0;
  return buttons.groups.reduce((total, group) => total + group.buttons.length, 0);
}

/**
 * ダッシュボードに出すぶんだけに絞る。
 *
 * API は隠したボタンも `hidden: true` を付けて返す（設定画面が一覧に出すため）。
 * カードに出す段階でここを通す。1つも残らなかったグループは、見出しだけが浮くので落とす。
 */
export function visibleRemoteGroups(buttons: RemoteButtons | null): RemoteGroup[] {
  if (!buttons) return [];
  return buttons.groups
    .map((group) => ({
      ...group,
      buttons: group.buttons.filter((button) => !button.hidden),
    }))
    .filter((group) => group.buttons.length > 0);
}

export function countVisibleRemoteButtons(buttons: RemoteButtons | null): number {
  return visibleRemoteGroups(buttons).reduce(
    (total, group) => total + group.buttons.length,
    0
  );
}

export function findRemoteButton(
  buttons: RemoteButtons | null,
  buttonId: string
): { group: RemoteGroup; button: RemoteButton } | null {
  if (!buttons) return null;
  for (const group of buttons.groups) {
    const button = group.buttons.find((entry) => entry.id === buttonId);
    if (button) return { group, button };
  }
  return null;
}

/** 「照明「点ける」を送りました」。グループ名とボタン名だけで、機器の状態は言わない */
export function formatRemoteSentMessage(result: RemoteSendResult): string {
  const group = result.group_name.trim();
  return group
    ? `${group}「${result.label}」を送りました`
    : `「${result.label}」を送りました`;
}

/** 失敗の理由。API が理由を返さなかったときだけ既定の文言へ落とす */
export function formatRemoteErrorMessage(message?: string): string {
  const trimmed = message?.trim();
  return trimmed || "送信できませんでした";
}
