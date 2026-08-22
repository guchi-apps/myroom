"use client";

import { Bot } from "lucide-react";
import {
  formatMonthlyRuns,
  formatRunDay,
  formatRunDuration,
  formatRunStart,
  formatRunTime,
  hasCleanerData,
  isCleaning,
  runRatio,
} from "@/lib/cleaner";
import type { CleanerRun, CleanerSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface CleanerCardProps {
  summary: CleanerSummary | null;
  loading: boolean;
  error: boolean;
}

function CardShell({
  children,
  status,
  running,
}: {
  children: React.ReactNode;
  status?: string;
  running?: boolean;
}) {
  return (
    <div className="device-card gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="device-card-title flex min-w-0 items-center gap-2">
          <Bot
            className="size-5 shrink-0"
            strokeWidth={1.9}
            style={{ color: "var(--cleaner-color)" }}
          />
          お掃除ロボット
        </p>
        {status && (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
              !running && "bg-muted text-muted-foreground"
            )}
            style={
              running
                ? { backgroundColor: "var(--cleaner-color)", color: "#fff" }
                : undefined
            }
          >
            {status}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/**
 * 直近の稼働1件。横棒の長さで「いつもより長かった／短かった」が並べて分かるようにする。
 * 稼働中の行は棒を伸ばさず、右端を「◯分経過」にして進行中だと分かるようにしている。
 */
function RunRow({ run, runs }: { run: CleanerRun; runs: readonly CleanerRun[] }) {
  return (
    <div className="flex items-center gap-2.5 text-[12.5px] tabular-nums">
      <span className="w-[68px] shrink-0 text-muted-foreground">
        {formatRunDay(run.started_at)}
      </span>
      <span className="w-10 shrink-0 font-bold">{formatRunTime(run.started_at)}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full opacity-75"
          style={{
            width: `${runRatio(runs, run) * 100}%`,
            backgroundColor: "var(--cleaner-color)",
          }}
        />
      </span>
      <span className="w-[52px] shrink-0 text-right text-muted-foreground">
        {formatRunDuration(run)}
      </span>
    </div>
  );
}

/**
 * 「暮らし」セクションのお掃除ロボットカード。
 *
 * 知りたいのは「最後にいつ動いたか」なので、それを一番大きく置く。**操作はできない**
 * （収集は観測だけで、起動・停止の経路を持たない）ため、押せる要素も詳細パネルも無い。
 */
export function CleanerCard({ summary, loading, error }: CleanerCardProps) {
  if (loading && !summary) {
    return (
      <CardShell>
        <div className="flex flex-col gap-2.5">
          <div className="h-[46px] animate-pulse rounded-2xl bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
        </div>
      </CardShell>
    );
  }

  if (error && !summary) {
    return (
      <CardShell>
        <p className="text-sm text-destructive">稼働履歴を読み込めませんでした</p>
      </CardShell>
    );
  }

  if (!hasCleanerData(summary)) {
    return (
      <CardShell>
        <p className="text-sm text-muted-foreground">
          まだ稼働を受け取っていません。サブPCからの送信が始まると、ここに起動した日時が並びます。
        </p>
      </CardShell>
    );
  }

  const data = summary as CleanerSummary;
  const running = isCleaning(data);
  const status = data.stale ? "不明" : data.current?.label;
  const battery = data.current?.battery ?? null;

  return (
    <CardShell status={status} running={running && !data.stale}>
      {data.last_run && (
        <div
          className="flex items-baseline gap-2.5 rounded-2xl px-3.5 py-2.5"
          style={{ backgroundColor: "var(--cleaner-surface)" }}
        >
          <span className="shrink-0 text-[12px] text-muted-foreground">最終起動</span>
          <span className="text-[22px] font-bold leading-none tracking-tight tabular-nums">
            {formatRunStart(data.last_run.started_at, data.now)}
          </span>
          <span className="ml-auto shrink-0 text-[13px] font-bold text-muted-foreground tabular-nums">
            {formatRunDuration(data.last_run)}
          </span>
        </div>
      )}

      {battery != null && (
        <div className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground tabular-nums">
          電池
          <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${battery}%`,
                backgroundColor: "var(--cleaner-color)",
              }}
            />
          </span>
          <span className="font-bold text-foreground">{battery}%</span>
        </div>
      )}

      {data.stale ? (
        <p className="text-xs" style={{ color: "var(--cleaner-color)" }}>
          サブPCからの受信が途絶えています
        </p>
      ) : (
        data.recent_runs.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {data.recent_runs.map((run) => (
              <RunRow key={run.started_at} run={run} runs={data.recent_runs} />
            ))}
          </div>
        )
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-2.5 text-[12px] text-muted-foreground tabular-nums">
        <span>{formatMonthlyRuns(data)}</span>
        {data.days_since_previous_run != null && (
          <span>
            前回から{" "}
            <b className="text-[13px] font-bold text-foreground">
              {data.days_since_previous_run === 0
                ? "同じ日"
                : `${data.days_since_previous_run}日`}
            </b>
          </span>
        )}
      </div>
    </CardShell>
  );
}
