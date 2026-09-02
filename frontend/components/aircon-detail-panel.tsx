"use client";

import { useMemo, useState } from "react";
import { AirVent, ChevronRight, X } from "lucide-react";
import { EnvironmentChart } from "@/components/environment-chart";
import type { ChartColorSettings } from "@/lib/chart-colors";
import {
  AIRCON_TARGET_VISIBILITY_KEY,
  deviceMetricVisibilityKey,
  type ChartLineVisibilitySettings,
} from "@/lib/chart-line-visibility";
import type { DisplayOrderItem } from "@/lib/display-order";
import { useChartHistory } from "@/lib/use-chart-history";
import {
  AIRCON_CHART_DEVICE_ID,
  buildAirconStatusPill,
  CHART_METRICS,
  type AirconData,
  type ChartMetric,
  type ChartViewRange,
  type HistoryPoint,
} from "@/lib/types";

const AIRCON_LEGEND_ORDER: readonly DisplayOrderItem[] = [{ type: "aircon" }];
const AIRCON_CHART_DEVICE_IDS: readonly number[] = [AIRCON_CHART_DEVICE_ID];
const EMPTY_HISTORY_DEVICE_IDS: readonly number[] = [];

interface AirconDetailPanelProps {
  open: boolean;
  /** カードに出している表示名。見出しとグラフの凡例に使う */
  title: string;
  acId: number;
  latest: AirconData | null;
  /** 操作パネルを開けるか（ログイン情報なし・オフラインでは false）。false のときはボタンごと出さない */
  controllable: boolean;
  chartColors: ChartColorSettings;
  /** グローバル設定（推移グラフの凡例など）。パネル内で表示中デバイスのラインだけ上書きする */
  lineVisibility: ChartLineVisibilitySettings;
  isOfflineMode?: boolean;
  offlineHistory?: HistoryPoint[] | null;
  offlineCacheKey?: string | null;
  onClose: () => void;
  onOpenControl: () => void;
  onLineVisibilityChange?: (key: string, visible: boolean) => void;
}

/**
 * エアコンカードの詳細パネル。
 *
 * 他の部屋（`DeviceDetailPanel`）と違い、実センサーの記録一覧・削除機能は持たない。
 * `AIRCON_CHART_DEVICE_ID`（#351）は仮想デバイスIDで実センサーAPIには存在しないため、
 * 記録一覧を持たせず、グラフとリモコン操作の入口だけの軽量なパネルにしている。
 * 開いている間だけマウントする方針は `OutdoorDetailPanel` と同じ（開き直すたびに
 * `useState` の初期値からやり直り、`react-hooks/set-state-in-effect` を増やさない）。
 */
export function AirconDetailPanel({
  open,
  title,
  acId,
  latest,
  controllable,
  chartColors,
  lineVisibility: lineVisibilityProp,
  isOfflineMode = false,
  offlineHistory = null,
  offlineCacheKey = null,
  onClose,
  onOpenControl,
  onLineVisibilityChange,
}: AirconDetailPanelProps) {
  const [chartMetric, setChartMetric] = useState<ChartMetric>("temperature");
  const [viewRange, setViewRange] = useState<ChartViewRange>("day");

  // カードを開いた本人がこのエアコンを選んでいるので、室温や凡例をどこかで
  // 非表示にしていても、このパネルの中でだけは必ずラインを出す（他部屋の
  // 詳細パネルでも同じ考え方。`OutdoorDetailPanel` の outdoor ライン上書きと対）
  const lineVisibility = useMemo(() => {
    const next = { ...lineVisibilityProp };
    for (const metric of CHART_METRICS) {
      next[deviceMetricVisibilityKey(AIRCON_CHART_DEVICE_ID, metric)] = true;
    }
    next[AIRCON_TARGET_VISIBILITY_KEY] = true;
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
  } = useChartHistory(EMPTY_HISTORY_DEVICE_IDS, viewRange, {
    airconAcId: acId,
    airconChartDeviceId: AIRCON_CHART_DEVICE_ID,
    offlineMode: isOfflineMode,
    offlineHistory,
    offlineCacheKey,
    pollIntervalMs: open && !isOfflineMode ? 30000 : 0,
  });

  if (!open) return null;

  const pill = buildAirconStatusPill(latest);

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[88vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <h2 className="truncate text-lg font-bold">{title}</h2>
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
          {controllable ? (
            <div className="px-4 pt-3">
              <button
                type="button"
                onClick={onOpenControl}
                className="flex min-h-12 w-full items-center gap-2.5 rounded-[14px] bg-secondary px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <AirVent
                  className="size-[19px] shrink-0"
                  strokeWidth={1.8}
                  style={{ color: pill.color ?? "var(--muted-foreground)" }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
                  エアコンを操作
                </span>
                {pill.color ? (
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums"
                    style={{ color: pill.color, backgroundColor: `${pill.color}24` }}
                  >
                    {pill.label}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                    {pill.label}
                  </span>
                )}
                <ChevronRight
                  className="size-[18px] shrink-0 text-muted-foreground/70"
                  strokeWidth={1.75}
                />
              </button>
            </div>
          ) : null}

          <div className="px-3 py-3">
            <EnvironmentChart
              historyData={historyData}
              deviceIds={AIRCON_CHART_DEVICE_IDS}
              deviceNames={{ [AIRCON_CHART_DEVICE_ID]: title }}
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
              legendOrder={AIRCON_LEGEND_ORDER}
              airconTargetDeviceId={AIRCON_CHART_DEVICE_ID}
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
