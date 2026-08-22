"use client";

import { Trash2 } from "lucide-react";
import {
  buildGarbageHighlight,
  buildGarbageRows,
  formatGarbageCategories,
  formatGarbageDate,
  type GarbageDay,
  type GarbageSchedule,
} from "@/lib/garbage";
import { cn } from "@/lib/utils";

interface GarbageCardProps {
  schedule: GarbageSchedule | null;
  loading: boolean;
  error: boolean;
}

function GarbageMessage({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** 品目の色は data/garbage.json の color をそのまま使う */
function CategoryBadges({ day }: { day: GarbageDay }) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {day.categories.map((category) => (
        <span
          key={category.id}
          className="rounded-full px-2.5 py-0.5 text-xs font-bold text-white"
          style={{ backgroundColor: category.color }}
        >
          {category.name}
        </span>
      ))}
    </div>
  );
}

export function GarbageCard({ schedule, loading, error }: GarbageCardProps) {
  const rows = schedule ? buildGarbageRows(schedule) : [];
  const highlight = schedule ? buildGarbageHighlight(schedule) : null;
  const notes = schedule
    ? [...new Set(rows.flatMap((row) => row.day.notes))]
    : [];

  return (
    <div className="device-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="device-card-title flex min-w-0 flex-1 items-center gap-2">
          <Trash2 className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          ゴミの日
        </p>
        {schedule?.area && (
          <span className="shrink-0 truncate text-xs text-muted-foreground">
            {schedule.area}
          </span>
        )}
      </div>

      {loading && <GarbageMessage>読み込み中...</GarbageMessage>}

      {!loading && error && (
        <p className="text-sm text-destructive">収集日を読み込めませんでした</p>
      )}

      {!loading && !error && schedule && !schedule.configured && (
        <GarbageMessage>
          収集日が未設定です（data/garbage.json に収集日を書くと表示されます）
        </GarbageMessage>
      )}

      {!loading && !error && schedule?.configured && (
        <div className="flex flex-col gap-3">
          {highlight && (
            <div
              className={cn(
                "flex items-center gap-3 rounded-2xl px-3.5 py-3",
                highlight.imminent ? "bg-primary/10" : "bg-muted"
              )}
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-[11px] tracking-wider text-muted-foreground">
                  次の収集
                </span>
                <span className="truncate text-lg font-bold leading-tight text-foreground">
                  {highlight.title}
                </span>
              </div>
              <div className="ml-auto min-w-0">
                <CategoryBadges day={highlight.day} />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2">
            {rows.map((row) => {
              const collected = row.day.categories.length > 0;
              return (
                <div
                  key={row.day.date}
                  className="flex items-baseline gap-2.5 text-sm"
                >
                  <span className="w-12 shrink-0 text-muted-foreground">
                    {row.label}
                  </span>
                  <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
                    {formatGarbageDate(row.day)}
                  </span>
                  <span
                    className={cn(
                      "flex min-w-0 flex-1 items-baseline gap-1.5",
                      collected ? "font-medium text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {collected && (
                      <span
                        className="size-2 shrink-0 translate-y-[-1px] rounded-[2px]"
                        style={{ backgroundColor: row.day.categories[0].color }}
                      />
                    )}
                    {formatGarbageCategories(row.day)}
                  </span>
                </div>
              );
            })}
          </div>

          {notes.length > 0 && (
            <p className="rounded-xl bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              {notes.join(" / ")}
            </p>
          )}

          {!highlight && (
            <GarbageMessage>この先の収集予定が見つかりませんでした</GarbageMessage>
          )}
        </div>
      )}
    </div>
  );
}
