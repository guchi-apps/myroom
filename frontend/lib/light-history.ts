/**
 * 照明が点いていた時間帯（#368）。
 *
 * バックエンド（`backend/light_history.py`）が組み立てた区間・一覧を、推移グラフと
 * 同じ時間軸へ重ねるための形に直す。**判定そのものはここでは行わない**——照度としきい値の
 * 突き合わせも、Nature Remo の状態の読み取りもサーバー側の仕事で、こちらは表示だけを持つ。
 *
 * 時刻はサーバーが返した JST の文字列をそのまま使い、`new Date(...)` で解釈し直すのは
 * 位置の計算に必要な数値化だけに留める（掃除の日付と同じ理由で、端末の時計に引っ張られる
 * 表示を作らない）。
 */

import type { LightSource } from "@/lib/types";

/** 区間の1つ。`open_start` / `open_end` は表示している期間の外へ続いていること */
export interface LightSegment {
  start: string;
  end: string;
  open_start: boolean;
  open_end: boolean;
  /** 日中にすっぽり収まる区間（照度から判定したときだけ立つ）。日射の可能性がある */
  daylight: boolean;
}

/** 一覧の1行。「その時刻に始まった状態」と、続いた長さ */
export interface LightHistoryEvent {
  datetime: string;
  status: "on" | "off";
  duration_minutes: number;
  /** その状態が期間の終わりまで続いている（＝まだ点いている・消えたまま） */
  continuing: boolean;
  daylight: boolean;
}

export interface LightHistorySource {
  kind: "illuminance" | "remo";
  /** Nature Remo の機器名。照度から判定する場合は空 */
  name: string;
  /** 点灯とみなす照度（lx）。Nature Remo から読む場合は null */
  threshold: number | null;
}

export interface LightHistory {
  device_id: number;
  start: string;
  end: string;
  /** null は「この場所に照明を紐付けていない」。履歴が空なのとは別 */
  source: LightHistorySource | null;
  segments: LightSegment[];
  events: LightHistoryEvent[];
  summary: { on_count: number; on_minutes: number };
}

/**
 * `/devices` の選択欄の値と、保存する形の相互変換（#368）。
 *
 * `<select>` は文字列しか持てないので、`""`（使わない）・`"illuminance"`・`"remo:<key>"`
 * の3通りへ畳む。**空文字は「紐付けを外す」**で、保存時はキーごと消す（`null` を保存すると
 * 「使わないと決めた」と「まだ決めていない」が同じ形になる）。
 */
export function lightSourceToDraft(source: LightSource | null | undefined): string {
  if (!source) return "";
  if (source.kind === "remo") return `remo:${source.appliance_key}`;
  return "illuminance";
}

export function draftToLightSource(draft: string | null | undefined): LightSource | null {
  const value = (draft ?? "").trim();
  if (value === "illuminance") return { kind: "illuminance" };
  if (value.startsWith("remo:")) {
    const key = value.slice("remo:".length);
    return key ? { kind: "remo", appliance_key: key } : null;
  }
  return null;
}

/** 判定の根拠を1行で。詳細パネルの帯の下に添える */
export function formatLightSourceNote(source: LightHistorySource): string {
  if (source.kind === "remo") {
    const name = source.name || "Nature Remo に登録した照明";
    return `${name}の状態を5分ごとに読んで記録しています`;
  }
  const threshold = source.threshold;
  if (threshold == null) {
    return "点灯とみなす照度を設定すると、履歴が出るようになります";
  }
  return `照度が ${formatThreshold(threshold)} lx を上回っていた時間帯を点灯として数えています`;
}

/** 帯の見出しに出す短い名前。「リビング照明 · 照度から判定」 */
export function formatLightSourceLabel(source: LightHistorySource): string {
  if (source.kind === "remo") {
    return source.name ? `${source.name} · Nature Remo の状態` : "Nature Remo の状態";
  }
  return "照度から判定";
}

/** しきい値の表示。整数はそのまま、小数が入っているときだけ1桁まで（`light-status.ts` と同じ） */
export function formatThreshold(threshold: number): string {
  return Number.isInteger(threshold) ? String(threshold) : threshold.toFixed(1);
}

/**
 * 分を「4時間37分」の形に。1時間未満は「37分」、0分は「0分」。
 *
 * **時間だけに丸めない。** 点けてすぐ消した記録が「0時間」になると、記録が壊れているように
 * 見える。
 */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
}

/** 一覧の時刻。同じ日に収まる期間なら「18:35」、またぐなら「9/5 18:35」 */
export function formatEventTime(datetime: string, withDate: boolean): string {
  const [date, time] = datetime.split("T");
  const hhmm = (time ?? "").slice(0, 5);
  if (!withDate) return hhmm;
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)} ${hhmm}`;
}

/** 期間が日をまたぐか。またぐときだけ一覧の時刻に日付を添える */
export function spansMultipleDays(start: string, end: string): boolean {
  return start.slice(0, 10) !== end.slice(0, 10);
}

function toTime(value: string): number {
  return new Date(value).getTime();
}

export interface BandPiece {
  /** 帯の左端（0〜1） */
  left: number;
  /** 帯の幅（0〜1） */
  width: number;
  openStart: boolean;
  openEnd: boolean;
  daylight: boolean;
  key: string;
}

/**
 * 区間を、表示中の時間軸（`domain`）上の位置へ直す。
 *
 * **グラフの表示範囲は取得した期間より狭いことがある**（凡例の期間切り替え・横スクロール）。
 * はみ出した区間は切り、切った側を `openStart` / `openEnd` として残す——切った端に丸みを
 * 付けないことで「ここで消したわけではない」を見た目で伝える。
 */
export function buildBandPieces(
  segments: readonly LightSegment[],
  domain: readonly [number, number]
): BandPiece[] {
  const [from, to] = domain;
  const span = to - from;
  if (!Number.isFinite(span) || span <= 0) return [];

  const pieces: BandPiece[] = [];
  for (const segment of segments) {
    const start = toTime(segment.start);
    const end = toTime(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end <= from || start >= to) continue;

    const clippedStart = Math.max(start, from);
    const clippedEnd = Math.min(end, to);
    pieces.push({
      left: (clippedStart - from) / span,
      width: Math.max((clippedEnd - clippedStart) / span, 0),
      openStart: segment.open_start || start < from,
      openEnd: segment.open_end || end > to,
      daylight: segment.daylight,
      key: segment.start,
    });
  }
  return pieces;
}

/** 表示中の時間軸に入っている一覧の行だけを残す */
export function filterEventsToDomain(
  events: readonly LightHistoryEvent[],
  domain: readonly [number, number]
): LightHistoryEvent[] {
  const [from, to] = domain;
  return events.filter((event) => {
    const at = toTime(event.datetime);
    return Number.isFinite(at) && at >= from && at <= to;
  });
}
