"use client";

import { Tile } from "@/components/power-detail-panel";
import {
  EnergyBarChartSkeleton,
  EnergyListSkeleton,
  EnergySkeletonFrame,
  EnergyTilesSkeleton,
} from "@/components/power-skeleton";
import {
  buildEnergyDailyRows,
  buildEnergySingleColumns,
  energyRowRatio,
  formatEnergyDate,
  formatEnergyDateWithWeekday,
  formatKwh,
  formatYen,
} from "@/lib/energy";
import type { EnergySourceSummary } from "@/lib/types";

interface PowerSourceDetailProps {
  label: string;
  color: string;
  summary: EnergySourceSummary | null;
  loading: boolean;
  error: boolean;
  /**
   * 読み込み表示で並べる日別行の数（#329）。
   * 取得前は日数が分からないので、親が持っている日別の件数を借りて高さを合わせる。
   */
  placeholderRows?: number;
}

/**
 * 消費電力の詳細パネルで、デバイスをクリックしたあとに表示する使用量推移。
 *
 * `power-detail-panel.tsx` 本体の日別積み上げ棒・日別一覧と同じマークアップだが、
 * 取得元を1つに絞っているため積み上げではなく単色の棒になる。
 */
export function PowerSourceDetail({
  label,
  color,
  summary,
  loading,
  error,
  placeholderRows,
}: PowerSourceDetailProps) {
  if (loading && !summary) {
    // 実データと同じ骨格を出して、シートの高さを動かさない（#329）
    const skeletonRows = Math.min(30, Math.max(4, placeholderRows ?? 10));
    return (
      <EnergySkeletonFrame>
        <EnergyTilesSkeleton />
        <EnergyBarChartSkeleton />
        <EnergyListSkeleton rows={skeletonRows} />
      </EnergySkeletonFrame>
    );
  }

  // 取り直しに失敗しても、前に取れている内容があればそれを出し続ける
  if (error && !summary) {
    return (
      <p className="text-sm text-destructive">使用量の推移を読み込めませんでした</p>
    );
  }

  if (!summary) return null;

  const columns = buildEnergySingleColumns(summary.daily);
  const rows = buildEnergyDailyRows(summary.daily);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <Tile caption="今月" total={summary.this_month} />
        <Tile caption="先月同日まで" total={summary.last_month_to_date} />
        <Tile caption="先月" total={summary.last_month} />
      </div>

      {columns.length > 1 && (
        <div className="flex flex-col gap-2">
          <div className="flex h-[110px] items-end gap-[3px]">
            {columns.map((column) => (
              <div
                key={column.date}
                className="min-w-0 flex-1 rounded-[1.5px]"
                style={{
                  height: `${Math.max(4, column.ratio * 100)}%`,
                  backgroundColor: color,
                }}
                title={`${formatEnergyDate(column.date)} ${formatKwh(column.kwh)}`}
              />
            ))}
          </div>
          <div className="flex justify-between border-t pt-1.5 text-[10.5px] text-muted-foreground tabular-nums">
            <span>{formatEnergyDate(columns[0].date)}</span>
            <span>日別（記録のある日だけ）</span>
            <span>{formatEnergyDate(columns[columns.length - 1].date)}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-[11.5px] text-muted-foreground">
          <span>{label}の日別（直近{rows.length}日）</span>
          <span>kWh / 円</span>
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            まだ使用量を受け取っていません
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.date}
              className="flex items-center gap-2.5 text-[13px] tabular-nums"
            >
              <span className="w-[68px] shrink-0 text-muted-foreground">
                {formatEnergyDateWithWeekday(row.date)}
              </span>
              <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full"
                  style={{
                    width: `${energyRowRatio(rows, row) * 100}%`,
                    backgroundColor: color,
                  }}
                />
              </span>
              <span className="w-[62px] shrink-0 text-right font-bold">
                {formatKwh(row.kwh)}
              </span>
              <span className="w-12 shrink-0 text-right text-muted-foreground">
                {formatYen(row.cost_yen)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
