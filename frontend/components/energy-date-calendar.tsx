"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildEnergyCalendarWeeks,
  energyMonthOf,
  formatEnergyMonthLabel,
  shiftEnergyMonth,
} from "@/lib/energy";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/**
 * 「時間ごと」の日付を選ぶカレンダー（#330）。
 *
 * **開いているあいだだけ描画すること。** 表示する月は `useState` の初期値として
 * `value` から作るので、開くたびに作り直される前提になっている
 * （effect で詰め直すと React の `set-state-in-effect` に引っかかる）。
 *
 * 詳細パネルの中に絶対配置すると、スクロール領域の端で切れる。パネルより上の
 * レイヤー（`fixed inset-0`）に重ね、スマホでは下から出るシートとして開く。
 */
interface EnergyDateCalendarProps {
  /** 選択中の日（`2026-09-02`） */
  value: string;
  /** 今日。これより後の日は選べない。取得できていないときは null */
  today: string | null;
  onSelect: (date: string) => void;
  onClose: () => void;
}

export function EnergyDateCalendar({
  value,
  today,
  onSelect,
  onClose,
}: EnergyDateCalendarProps) {
  const [month, setMonth] = useState(() => energyMonthOf(value));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const weeks = buildEnergyCalendarWeeks(month);
  // 今日を含む月から先へは送れない。未来の月はマスが全部選べず、開いても意味が無い
  const canGoNext = !today || month < energyMonthOf(today);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="日付を選ぶ"
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-[340px] flex-col gap-3 rounded-t-[20px] bg-card px-4 pb-7 pt-4 shadow-lg sm:max-w-[320px] sm:rounded-[20px] sm:pb-4"
      >
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonth(shiftEnergyMonth(month, -1))}
            className="flex size-8 items-center justify-center rounded-full bg-muted"
            aria-label="前の月"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-bold tabular-nums">
            {formatEnergyMonthLabel(month)}
          </span>
          <button
            type="button"
            onClick={() => setMonth(shiftEnergyMonth(month, 1))}
            disabled={!canGoNext}
            className="flex size-8 items-center justify-center rounded-full bg-muted disabled:opacity-35"
            aria-label="次の月"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((weekday, index) => (
            <div
              key={weekday}
              className={`pb-0.5 text-center text-[10.5px] font-bold ${
                index === 0
                  ? "text-red-400"
                  : index === 6
                    ? "text-blue-400"
                    : "text-muted-foreground"
              }`}
            >
              {weekday}
            </div>
          ))}
          {weeks.map((week, weekIndex) =>
            week.map((date, dayIndex) => {
              if (!date) {
                return <span key={`${weekIndex}-${dayIndex}`} aria-hidden />;
              }
              const selected = date === value;
              const isToday = date === today;
              const future = today != null && date > today;
              return (
                <button
                  key={date}
                  type="button"
                  disabled={future}
                  onClick={() => onSelect(date)}
                  aria-current={selected ? "date" : undefined}
                  className={`flex aspect-square items-center justify-center rounded-xl text-[13px] tabular-nums disabled:opacity-30 ${
                    selected
                      // 選択中はアンバーで塗る。文字はライト・ダークどちらでも同じ
                      // アンバーの上に乗るため、テーマに寄らない濃い色で固定する
                      ? "bg-[var(--energy-color)] font-bold text-[#1f1f1f]"
                      : isToday
                        ? "font-bold text-[var(--energy-color)] ring-1 ring-inset ring-[var(--energy-color)]"
                        : "hover:bg-accent"
                  }`}
                >
                  {Number(date.slice(8))}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-0.5">
          <span className="text-[11px] text-muted-foreground">
            今日より後は選べません
          </span>
          <button
            type="button"
            onClick={() => today && onSelect(today)}
            disabled={!today}
            className="rounded-full bg-muted px-4 py-1.5 text-xs font-bold disabled:opacity-40"
          >
            今日
          </button>
        </div>
      </div>
    </div>
  );
}
