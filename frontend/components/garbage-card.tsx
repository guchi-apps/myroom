"use client";

import { Trash2 } from "lucide-react";
import {
  buildGarbageRows,
  formatGarbageCategories,
  formatGarbageDate,
  hasImminentCollection,
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

export function GarbageCard({ schedule, loading, error }: GarbageCardProps) {
  const rows = schedule ? buildGarbageRows(schedule) : [];
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
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const collected = row.day.categories.length > 0;
            const highlight = collected && row.day.days_until <= 1;
            return (
              <div key={row.label} className="flex items-baseline gap-2 text-sm">
                <span className="w-14 shrink-0 text-muted-foreground">{row.label}</span>
                <span className="w-20 shrink-0 text-muted-foreground">
                  {formatGarbageDate(row.day)}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    highlight
                      ? "text-base font-bold leading-snug text-foreground"
                      : collected
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                  )}
                >
                  {formatGarbageCategories(row.day)}
                </span>
              </div>
            );
          })}

          {notes.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {notes.join(" / ")}
            </p>
          )}

          {!hasImminentCollection(schedule) && schedule.upcoming.length === 0 && (
            <GarbageMessage>この先の収集予定が見つかりませんでした</GarbageMessage>
          )}
        </div>
      )}
    </div>
  );
}
