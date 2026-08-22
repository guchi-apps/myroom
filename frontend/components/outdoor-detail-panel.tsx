"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { CurrentReadings } from "@/components/current-readings";
import { EnvironmentChart } from "@/components/environment-chart";
import type { ChartColorSettings } from "@/lib/chart-colors";
import {
  outdoorMetricVisibilityKey,
  type ChartLineVisibilitySettings,
} from "@/lib/chart-line-visibility";
import type { DisplayOrderItem } from "@/lib/display-order";
import { buildOutdoorReadings } from "@/lib/device-metrics";
import { useOutdoorChartHistory } from "@/lib/use-outdoor-chart-history";
import {
  CHART_METRICS,
  formatOutdoorApiLabel,
  type ChartMetric,
  type ChartViewRange,
  type HistoryPoint,
  type LatestData,
} from "@/lib/types";

const OUTDOOR_LEGEND_ORDER: readonly DisplayOrderItem[] = [{ type: "outdoor" }];
const EMPTY_DEVICE_IDS: readonly number[] = [];
const EMPTY_DEVICE_NAMES: Record<number, string> = {};

interface OutdoorDetailPanelProps {
  open: boolean;
  locationName?: string;
  /** カードから外した気圧を「いまの値」として出すための最新データ（#226） */
  latest?: LatestData | null;
  chartColors: ChartColorSettings;
  lineVisibility: ChartLineVisibilitySettings;
  isOfflineMode?: boolean;
  offlineHistory?: HistoryPoint[] | null;
  offlineCacheKey?: string | null;
  onClose: () => void;
  onLineVisibilityChange?: (key: string, visible: boolean) => void;
}

export function OutdoorDetailPanel({
  open,
  locationName,
  latest = null,
  chartColors,
  lineVisibility: lineVisibilityProp,
  isOfflineMode = false,
  offlineHistory = null,
  offlineCacheKey = null,
  onClose,
  onLineVisibilityChange,
}: OutdoorDetailPanelProps) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>("temperature");
  const [viewRange, setViewRange] = useState<ChartViewRange>("day");

  useEffect(() => {
    if (!open) return;
    setChartMetric("temperature");
    setViewRange("day");
  }, [open]);

  // パネルを開いた際は outdoor ラインを常に表示する(グローバル設定に関わらず)
  const lineVisibility = useMemo(() => {
    const next = { ...lineVisibilityProp };
    for (const metric of CHART_METRICS) {
      next[outdoorMetricVisibilityKey(metric)] = true;
    }
    return next;
  }, [lineVisibilityProp]);

  const {
    historyData,
    historyLoading,
    awaitingLatest,
    loadingRange,
    historyEpoch,
    noMoreOlderData,
    ensureVisibleRangeLoaded,
  } = useOutdoorChartHistory(viewRange, {
    offlineMode: isOfflineMode,
    offlineHistory,
    offlineCacheKey,
    pollIntervalMs: open && !isOfflineMode ? 30000 : 0,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[88vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">
              {formatOutdoorApiLabel(locationName)}
            </h2>
            <p className="text-xs text-muted-foreground">Open-Meteo API</p>
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
          <CurrentReadings
            readings={buildOutdoorReadings(latest)}
            measuredAt={latest?.datetime}
          />
          <div className="px-3 py-3">
            <EnvironmentChart
              historyData={historyData}
              deviceIds={EMPTY_DEVICE_IDS}
              deviceNames={EMPTY_DEVICE_NAMES}
              chartMetric={chartMetric}
              onChartMetricChange={setChartMetric}
              viewRange={viewRange}
              onViewRangeChange={setViewRange}
              loading={false}
              historyLoading={historyLoading || loadingRange}
              awaitingLatest={awaitingLatest}
              historyEpoch={historyEpoch}
              noMoreOlderData={noMoreOlderData}
              onVisibleDomainChange={ensureVisibleRangeLoaded}
              legendOrder={OUTDOOR_LEGEND_ORDER}
              outdoorLocationName={locationName}
              chartColors={chartColors}
              lineVisibility={lineVisibility}
              onLineVisibilityChange={onLineVisibilityChange ?? (() => {})}
              pinMetricTabsOnMobile={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
