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

/**
 * Nature Remo に登録済みの操作のうち、ボタンにできるもの1つ（#262）。
 *
 * **signal ID・appliance ID は入っていない。** 登録に使うのは `id` だけで、
 * どこへ送るかはバックエンドが引く。
 */
export interface RemoteCatalogButton {
  id: string;
  /** Nature Remo 側の名前 */
  label: string;
  /** "light"（照明として登録）か "signal"（その他の赤外線） */
  kind: string;
}

export interface RemoteCatalogDevice {
  id: string;
  /** Nature Remo のニックネーム。登録するとそのままグループの見出しになる */
  name: string;
  type: string;
  /** 押せない理由。空でなければボタンの代わりにこれを出す */
  note: string;
  buttons: RemoteCatalogButton[];
}

export interface RemoteCatalog {
  /** 最後に Nature Remo へ問い合わせた時刻（ISO・UTC）。一度も取っていなければ空 */
  fetched_at: string;
  devices: RemoteCatalogDevice[];
}

/** 登録内容として送る形。ボタンはIDだけで、送り先はバックエンドが引く */
export interface RemoteConfigGroup {
  id: string;
  name: string;
  buttons: { id: string }[];
}

export interface RemoteConfigUpdate {
  groups: RemoteConfigGroup[];
  buttons: Record<string, RemoteButtonSetting>;
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

/** 「電気の操作」の名前とグループを編集している最中の1グループ */
export interface RemoteGroupDraft {
  id: string;
  name: string;
  buttons: { id: string; defaultLabel: string }[];
}

/**
 * サーバーから来た一覧を、編集中のグループへ。
 *
 * `default_label` が「Nature Remo 側の名前」で、`label` は付けた名前が入り得る。
 * 登録内容として持つのは前者。
 */
export function toGroupDrafts(buttons: RemoteButtons | null): RemoteGroupDraft[] {
  return (buttons?.groups ?? []).map((group) => ({
    id: group.id,
    name: group.name,
    buttons: group.buttons.map((button) => ({
      id: button.id,
      defaultLabel: button.default_label ?? button.label,
    })),
  }));
}

/** 編集中のグループに入っているボタンIDを全部集める */
export function collectDraftButtonIds(groups: RemoteGroupDraft[]): Set<string> {
  return new Set(groups.flatMap((group) => group.buttons.map((button) => button.id)));
}

/**
 * 候補一覧での選択を、編集中のグループへ反映する。
 *
 * - 選択が外れたボタンは落とす。1つも残らないグループは見出しごと消す
 * - 新しく選ばれたボタンは、その機器のグループへ足す。グループがまだ無ければ作る
 * - **すでにあるボタンの位置は動かさない。** 選び直すたびに並びが変わると、
 *   せっかく並べ替えた順序が壊れる
 */
export function applyCatalogSelection(
  groups: RemoteGroupDraft[],
  catalog: RemoteCatalog,
  selected: ReadonlySet<string>
): RemoteGroupDraft[] {
  const kept: RemoteGroupDraft[] = groups
    .map((group) => ({
      ...group,
      buttons: group.buttons.filter((button) => selected.has(button.id)),
    }))
    .filter((group) => group.buttons.length > 0);

  const known = collectDraftButtonIds(kept);

  for (const device of catalog.devices) {
    const added = device.buttons
      .filter((button) => selected.has(button.id) && !known.has(button.id))
      .map((button) => ({ id: button.id, defaultLabel: button.label }));
    if (added.length === 0) continue;
    for (const button of added) known.add(button.id);

    const index = kept.findIndex((group) => group.id === device.id);
    if (index >= 0) {
      kept[index] = { ...kept[index], buttons: [...kept[index].buttons, ...added] };
    } else {
      kept.push({ id: device.id, name: device.name, buttons: added });
    }
  }

  return kept;
}

/** グループを1つ上／下へ。端では動かさない */
export function moveRemoteGroup(
  groups: RemoteGroupDraft[],
  index: number,
  direction: -1 | 1
): RemoteGroupDraft[] {
  const next = index + direction;
  if (next < 0 || next >= groups.length) return groups;
  const moved = [...groups];
  [moved[index], moved[next]] = [moved[next], moved[index]];
  return moved;
}

/**
 * グループの中でボタンを1つ上／下へ。端では動かさない（#269）。
 *
 * **動かせるのは同じグループの中だけ。** グループは Nature Remo の機器そのもので、
 * `applyCatalogSelection()` も機器ごとにボタンを足す。またいで動かせるようにすると、
 * 選び直したときに戻る先が決まらない。
 */
export function moveRemoteButton(
  groups: RemoteGroupDraft[],
  groupIndex: number,
  buttonIndex: number,
  direction: -1 | 1
): RemoteGroupDraft[] {
  const group = groups[groupIndex];
  if (!group) return groups;

  const next = buttonIndex + direction;
  if (next < 0 || next >= group.buttons.length) return groups;

  const buttons = [...group.buttons];
  [buttons[buttonIndex], buttons[next]] = [buttons[next], buttons[buttonIndex]];
  return groups.map((entry, index) =>
    index === groupIndex ? { ...entry, buttons } : entry
  );
}

/** ボタンを1つ登録から外す。空になったグループは見出しごと消す */
export function removeRemoteButton(
  groups: RemoteGroupDraft[],
  buttonId: string
): RemoteGroupDraft[] {
  return groups
    .map((group) => ({
      ...group,
      buttons: group.buttons.filter((button) => button.id !== buttonId),
    }))
    .filter((group) => group.buttons.length > 0);
}

/**
 * 保存する形へ。グループ名が空の行は、Nature Remo 側の名前が分からないので落とす
 * （バックエンドも名前の無いグループは捨てる）。
 */
export function buildRemoteConfigUpdate(
  groups: RemoteGroupDraft[],
  settings: Record<string, RemoteButtonSetting>
): RemoteConfigUpdate {
  const alive = collectDraftButtonIds(groups);
  return {
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name.trim(),
      buttons: group.buttons.map((button) => ({ id: button.id })),
    })),
    // 登録から外したボタンの設定は送らない（バックエンドでも落とすが、送る意味が無い）
    buttons: Object.fromEntries(
      Object.entries(settings).filter(([id]) => alive.has(id))
    ),
  };
}

/** 「8/26 20:14」。まだ一度も取っていなければ空文字を返す */
export function formatCatalogFetchedAt(fetchedAt: string): string {
  if (!fetchedAt) return "";
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

/** 候補一覧に押せる操作が1つでもあるか（無ければ「読み込む」を促す） */
export function hasSelectableRemoteButtons(catalog: RemoteCatalog | null): boolean {
  return (catalog?.devices ?? []).some((device) => device.buttons.length > 0);
}
