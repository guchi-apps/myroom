"use client";

import { Sparkles } from "lucide-react";
import { SettingsIconButton } from "@/components/ui/settings-icon-button";
import {
  buildCleaningRows,
  buildCleaningTodo,
  formatCleaningCountdown,
  formatCleaningDate,
  formatCleaningIntervalShort,
  type CleaningSchedule,
  type CleaningTask,
} from "@/lib/cleaning";
import { cn } from "@/lib/utils";

interface CleaningCardProps {
  schedule: CleaningSchedule | null;
  loading: boolean;
  error: boolean;
  /** 記録の送信中（連打で二重に記録しないよう、その行のボタンだけ止める） */
  busyTaskId: string | null;
  onOpenTask: (task: CleaningTask) => void;
  onOpenSettings: () => void;
  onMarkDone: (task: CleaningTask) => void;
}

function CleaningMessage({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * 掃除カード。
 *
 * 先頭の「今日やること」は、期限を過ぎたものと今日が期限のものだけを出す。
 * ここに全部を並べると「そろそろやる」と「もうやるべき」の区別が付かない。
 * 1件も無ければブロックごと消えて、下の一覧だけが残る。
 */
export function CleaningCard({
  schedule,
  loading,
  error,
  busyTaskId,
  onOpenTask,
  onOpenSettings,
  onMarkDone,
}: CleaningCardProps) {
  const todo = schedule ? buildCleaningTodo(schedule) : [];
  const rows = schedule ? buildCleaningRows(schedule) : [];

  return (
    <div className="device-card">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <p className="device-card-title whitespace-nowrap">掃除</p>
        <SettingsIconButton
          label="掃除の設定"
          onClick={onOpenSettings}
          className="ml-auto"
        />
      </div>

      {loading && <CleaningMessage>読み込み中...</CleaningMessage>}

      {!loading && error && (
        <p className="text-sm text-destructive">掃除の予定を読み込めませんでした</p>
      )}

      {!loading && !error && schedule && !schedule.configured && (
        <CleaningMessage>
          掃除の予定がまだありません（右上の設定アイコンから場所を追加できます）
        </CleaningMessage>
      )}

      {!loading && !error && schedule?.configured && (
        <div className="flex flex-col gap-3">
          {todo.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-2xl bg-amber-50 px-3.5 py-3 dark:bg-amber-950/40">
              <p className="text-[11px] font-bold tracking-wider text-amber-700 dark:text-amber-400">
                今日やること
              </p>
              {todo.map((task) => (
                <div key={task.id} className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => onOpenTask(task)}
                    className="min-w-0 truncate text-left text-[15px] font-bold leading-tight text-foreground"
                  >
                    {task.name}
                  </button>
                  <span className="shrink-0 text-xs font-bold text-amber-700 dark:text-amber-400">
                    {formatCleaningCountdown(task)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onMarkDone(task)}
                    disabled={busyTaskId != null}
                    className="ml-auto shrink-0 rounded-full bg-amber-600 px-3.5 py-1 text-xs font-bold text-white disabled:opacity-50 dark:bg-amber-500 dark:text-amber-950"
                  >
                    {busyTaskId === task.id ? "記録中" : "やった"}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col">
            <p className="mb-1.5 text-[11px] tracking-wider text-muted-foreground">
              場所ごとの次の掃除
            </p>
            {rows.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task)}
                className="flex items-baseline gap-2 border-t border-border py-1.5 text-left text-sm first:border-t-0"
              >
                <span className="size-2 shrink-0 translate-y-[-1px] rounded-[2px] bg-emerald-600 dark:bg-emerald-400" />
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="min-w-0 truncate font-medium text-foreground">
                    {task.name}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {formatCleaningIntervalShort(task.interval_days)}
                  </span>
                </span>
                <span className="shrink-0 font-bold tabular-nums text-foreground">
                  {formatCleaningDate(task.next_due)}
                </span>
                <span
                  className={cn(
                    "w-16 shrink-0 text-right text-xs tabular-nums",
                    task.status === "upcoming"
                      ? "text-muted-foreground"
                      : "font-bold text-amber-600 dark:text-amber-400"
                  )}
                >
                  {formatCleaningCountdown(task)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
