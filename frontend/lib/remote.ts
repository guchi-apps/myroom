/**
 * 「電気の操作」カードの型と、押した結果の文言。
 *
 * 状態（照明が点いているか）は持たない。赤外線は片方向で機器から返事が来ないため、
 * 分かるのは「Nature Remo が送信を受け付けたところまで」だけ。文言もそこで止める（#106）。
 */

export interface RemoteButton {
  id: string;
  label: string;
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

export function countRemoteButtons(buttons: RemoteButtons | null): number {
  if (!buttons) return 0;
  return buttons.groups.reduce((total, group) => total + group.buttons.length, 0);
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
