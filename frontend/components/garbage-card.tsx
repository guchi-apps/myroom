"use client";

import { Check, Trash2 } from "lucide-react";
import {
  buildGarbageCategoryRows,
  buildGarbageHighlight,
  buildGarbageRows,
  collectGarbageNotes,
  formatGarbageCategories,
  formatGarbageCollectionTime,
  formatGarbageCountdown,
  formatGarbageDate,
  isGarbageComingSoon,
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
  const categoryRows = schedule ? buildGarbageCategoryRows(schedule) : [];
  const highlight = schedule ? buildGarbageHighlight(schedule) : null;
  const notes = schedule ? collectGarbageNotes(schedule) : [];
  const collectionTime = formatGarbageCollectionTime(schedule?.collection_time);

  return (
    <div className="device-card">
      {/* 見出しの右に長い地区名を置くと横幅を奪って縦組みに潰れるため、見出しだけを1行で置く（#207） */}
      <p className="device-card-title mb-3 flex items-center gap-2 whitespace-nowrap">
        <Trash2 className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        ゴミの日
      </p>

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
              // 収集が済んだ日は行を消さず、品目名を落として「済んだ」と分かるようにする（#270）
              const done = collected && row.done;
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
                      collected && !done
                        ? "font-medium text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {collected && (
                      <span
                        className={cn(
                          "size-2 shrink-0 translate-y-[-1px] rounded-[2px]",
                          done && "bg-muted-foreground/40"
                        )}
                        style={
                          done
                            ? undefined
                            : { backgroundColor: row.day.categories[0].color }
                        }
                      />
                    )}
                    <span className={cn("min-w-0 truncate", done && "line-through")}>
                      {formatGarbageCategories(row.day)}
                    </span>
                    {done && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border px-1.5 text-[10px] leading-[17px] text-muted-foreground tabular-nums">
                        <Check className="size-2.5" strokeWidth={3.5} />
                        {collectionTime ? `${collectionTime} 収集済み` : "収集済み"}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {categoryRows.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 text-[11px] tracking-wider text-muted-foreground">
                品目ごとの次の収集
              </p>
              <div className="flex flex-col">
                {categoryRows.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-baseline gap-2 border-t border-border py-1 text-sm first:border-t-0"
                  >
                    <span
                      className="size-2 shrink-0 translate-y-[-1px] rounded-[2px]"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {entry.name}
                    </span>
                    {entry.next ? (
                      <>
                        <span className="shrink-0 font-bold tabular-nums text-foreground">
                          {formatGarbageDate(entry.next)}
                        </span>
                        <span
                          className={cn(
                            "w-14 shrink-0 text-right text-xs tabular-nums",
                            isGarbageComingSoon(entry)
                              ? "font-bold text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground"
                          )}
                        >
                          {formatGarbageCountdown(entry.next)}
                        </span>
                      </>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        予定なし
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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
