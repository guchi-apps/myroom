"use client";

import { X } from "lucide-react";
import { DailyStatsList } from "@/components/daily-stats-list";
import { EnvironmentChart } from "@/components/environment-chart";
import type { ChartColorSettings } from "@/lib/chart-colors";
import type { ChartLineVisibilitySettings } from "@/lib/chart-line-visibility";
import type { DisplayOrderItem } from "@/lib/display-order";
import type {
  ChartMetric,
  ChartViewRange,
  DailyStat,
  HistoryPoint,
  LatestData,
} from "@/lib/types";

interface TrendPanelProps {
  open: boolean;
  onClose: () => void;

  /* グラフ */
  historyData: HistoryPoint[];
  chartDeviceIds: readonly number[];
  deviceNames: Record<number, string>;
  chartMetric: ChartMetric;
  onChartMetricChange: (metric: ChartMetric) => void;
  viewRange: ChartViewRange;
  onViewRangeChange: (range: ChartViewRange) => void;
  chartLoading: boolean;
  historyLoading: boolean;
  awaitingLatest: boolean;
  historyEpoch: number;
  noMoreOlderData: boolean;
  onVisibleDomainChange: (min: number, max: number) => void;
  airconTargetDeviceId: number;
  outdoorLocationName?: string;
  /** 屋外ラインが指す基準地点のID（凡例を1行に保つため。#358） */
  outdoorPrimaryLocationId?: string | null;
  legendOrder: DisplayOrderItem[];
  chartColors: ChartColorSettings;
  lineVisibility: ChartLineVisibilitySettings;
  onLineVisibilityChange: (key: string, visible: boolean) => void;

  /* 最近の記録 */
  dailyStatsByDevice: Record<number, DailyStat[]>;
  dailyStatsDeviceIds: readonly number[];
  latestByDevice: Record<number, LatestData | null>;
  dailyLimit: number;
  onLoadMoreDailyStats: () => void;
}

/**
 * 「推移」パネル。
 *
 * 推移グラフと最近の記録はダッシュボードから外し、「いまの環境」の見出しから開くこの画面へ
 * まとめた（#226）。ダッシュボードで見たいのは「いま何度か」で、時系列は掘り下げる情報のため。
 *
 * 履歴の読み込み（`useChartHistory`）とオフラインキャッシュの構築はダッシュボード側に残し、
 * ここへは props で渡す。パネルを開いたときに読み直さないのと、オフラインのスナップショットを
 * 作る場所を1か所に保つため。
 */
export function TrendPanel({
  open,
  onClose,
  historyData,
  chartDeviceIds,
  deviceNames,
  chartMetric,
  onChartMetricChange,
  viewRange,
  onViewRangeChange,
  chartLoading,
  historyLoading,
  awaitingLatest,
  historyEpoch,
  noMoreOlderData,
  onVisibleDomainChange,
  airconTargetDeviceId,
  outdoorLocationName,
  outdoorPrimaryLocationId,
  legendOrder,
  chartColors,
  lineVisibility,
  onLineVisibilityChange,
  dailyStatsByDevice,
  dailyStatsDeviceIds,
  latestByDevice,
  dailyLimit,
  onLoadMoreDailyStats,
}: TrendPanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[88vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">推移</h2>
            <p className="text-xs text-muted-foreground">
              指標を選ぶと、グラフと最近の記録が切り替わります
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent"
            aria-label="閉じる"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          <div className="px-3 py-3">
            <EnvironmentChart
              historyData={historyData}
              deviceIds={chartDeviceIds}
              deviceNames={deviceNames}
              chartMetric={chartMetric}
              onChartMetricChange={onChartMetricChange}
              viewRange={viewRange}
              onViewRangeChange={onViewRangeChange}
              loading={chartLoading}
              historyLoading={historyLoading}
              awaitingLatest={awaitingLatest}
              historyEpoch={historyEpoch}
              noMoreOlderData={noMoreOlderData}
              onVisibleDomainChange={onVisibleDomainChange}
              airconTargetDeviceId={airconTargetDeviceId}
              outdoorLocationName={outdoorLocationName}
              outdoorPrimaryLocationId={outdoorPrimaryLocationId}
              legendOrder={legendOrder}
              chartColors={chartColors}
              lineVisibility={lineVisibility}
              onLineVisibilityChange={onLineVisibilityChange}
              pinMetricTabsOnMobile={false}
            />
          </div>

          <div className="px-3 pb-4">
            <div className="mb-3 px-2">
              <h3 className="text-[17px] font-bold leading-tight">最近の記録</h3>
            </div>
            <DailyStatsList
              dailyStatsByDevice={dailyStatsByDevice}
              deviceIds={dailyStatsDeviceIds}
              deviceNames={deviceNames}
              chartMetric={chartMetric}
              latestByDevice={latestByDevice}
              dailyLimit={dailyLimit}
              chartColors={chartColors}
              onLoadMore={onLoadMoreDailyStats}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
