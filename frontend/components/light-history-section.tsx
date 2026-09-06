"use client";

import { Lightbulb } from "lucide-react";
import {
  filterEventsToDomain,
  formatDuration,
  formatEventTime,
  formatLightSourceNote,
  spansMultipleDays,
  type LightHistory,
  type LightHistoryEvent,
} from "@/lib/light-history";

/**
 * 詳細パネルの推移グラフの下に置く、点灯・消灯の一覧（#368）。
 *
 * 帯（`EnvironmentChart` の `LightBand`）が「いつ点いていたか」を形で見せるのに対し、
 * ここは「何時に点けて、どれだけ続いたか」を数字で見せる。**帯と同じ範囲だけを出す**——
 * グラフを横にスクロールすると帯の中身が変わるので、一覧だけ取り残されると
 * 目の前の帯と行が食い違う。
 */

const LIT_COLOR = "var(--remote-color)";
const LIT_SURFACE = "color-mix(in srgb, var(--remote-color) 18%, transparent)";

/** 一覧に出す上限。月・年の範囲では数百件になるため、古いものから隠す */
const MAX_ROWS = 60;

interface LightHistorySectionProps {
  history: LightHistory;
  /** グラフが今見せている時間軸。省略すると取得した範囲すべてを出す */
  visibleDomain?: readonly [number, number] | null;
}

function EventRow({ event, withDate }: { event: LightHistoryEvent; withDate: boolean }) {
  const isOn = event.status === "on";
  return (
    <div className="grid grid-cols-[3.25rem_auto_1fr] items-center gap-2.5 border-b py-1.5 last:border-b-0">
      <span className="text-[13px] font-bold tabular-nums">
        {formatEventTime(event.datetime, withDate)}
      </span>
      <span
        className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${
          isOn ? "" : "bg-muted text-muted-foreground"
        }`}
        style={isOn ? { color: LIT_COLOR, backgroundColor: LIT_SURFACE } : undefined}
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden />
        {isOn ? "点灯" : "消灯"}
      </span>
      <span className="text-right text-[11.5px] tabular-nums text-muted-foreground">
        {event.daylight ? (
          <span className="mr-1.5 rounded-full border px-1.5 text-[10.5px]">
            日射の可能性
          </span>
        ) : null}
        {event.continuing ? (
          <span className="mr-1 font-bold" style={{ color: isOn ? LIT_COLOR : undefined }}>
            継続中
          </span>
        ) : null}
        {formatDuration(event.duration_minutes)}
      </span>
    </div>
  );
}

export function LightHistorySection({ history, visibleDomain }: LightHistorySectionProps) {
  const source = history.source;
  if (!source) return null;

  const events = visibleDomain
    ? filterEventsToDomain(history.events, visibleDomain)
    : history.events;
  const rows = events.slice(0, MAX_ROWS);
  const hiddenCount = events.length - rows.length;

  // 期間が日をまたぐときだけ、行の時刻に日付を添える
  const withDate = spansMultipleDays(history.start, history.end);

  const onCount = events.filter((event) => event.status === "on").length;
  const onMinutes = events
    .filter((event) => event.status === "on")
    .reduce((total, event) => total + event.duration_minutes, 0);

  return (
    <section className="px-5 pb-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold">点灯・消灯</h3>
        <p className="text-[11.5px] tabular-nums text-muted-foreground">
          {onCount}回 · {formatDuration(onMinutes)}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="py-3 text-[12px] text-muted-foreground">
          この期間には記録がありません
        </p>
      ) : (
        <div className="mt-1.5 flex flex-col">
          {rows.map((event) => (
            <EventRow key={`${event.datetime}-${event.status}`} event={event} withDate={withDate} />
          ))}
        </div>
      )}

      {hiddenCount > 0 ? (
        <p className="pt-2 text-[11px] text-muted-foreground">他 {hiddenCount} 件</p>
      ) : null}

      <div className="mt-3 flex items-start gap-2.5 rounded-[14px] bg-muted px-3.5 py-2.5">
        <Lightbulb
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {formatLightSourceNote(source)}
          {source.kind === "illuminance"
            ? "。日中は日射だけで上回ることがあるため、6:00〜18:00 に収まる区間には印を付けています"
            : "。アレクサ・アプリ・Nature Remo アプリのどれで操作しても記録されます"}
        </p>
      </div>
    </section>
  );
}
