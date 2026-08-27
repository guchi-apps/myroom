/**
 * ヘッダーに出す「最終更新」の表示。
 *
 * 以前は `2026/08/27 21:46` と年から出していたが、ヘッダーではアプリ名と同じくらいの
 * 幅を取り、どちらが主役か分からなくなっていた（#277）。ほとんどの場合は当日の値なので、
 * **同じ日なら時刻だけ**にする。日をまたいだ古いデータのときだけ月日を足し、
 * 「いつのものか分からない」状態は作らない。
 */
export function formatUpdatedAt(timestampMs: number | null, now: Date = new Date()): string {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return "--";

  const updated = new Date(timestampMs);
  if (Number.isNaN(updated.getTime())) return "--";

  const time = `${pad(updated.getHours())}:${pad(updated.getMinutes())}`;
  if (isSameDay(updated, now)) return time;

  return `${updated.getMonth() + 1}/${updated.getDate()} ${time}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
