"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { CurrentReadings } from "@/components/current-readings";
import { EnvironmentChart } from "@/components/environment-chart";
import { WeatherIcon } from "@/lib/weather-icon";
import type { ChartColorSettings } from "@/lib/chart-colors";
import {
  outdoorMetricVisibilityKey,
  type ChartLineVisibilitySettings,
} from "@/lib/chart-line-visibility";
import type { DisplayOrderItem } from "@/lib/display-order";
import { buildOutdoorReadings } from "@/lib/device-metrics";
import { fetchOutdoorLocations, fetchOutdoorLocationWeather } from "@/lib/api";
import { useOutdoorChartHistory } from "@/lib/use-outdoor-chart-history";
import { usePanelLineVisibility } from "@/lib/use-panel-line-visibility";
import {
  CHART_METRICS,
  formatOutdoorApiLabel,
  type ChartMetric,
  type ChartViewRange,
  type HistoryPoint,
  type LatestData,
  type OutdoorLocationEntry,
  type OutdoorLocationWeather,
} from "@/lib/types";

const OUTDOOR_LEGEND_ORDER: readonly DisplayOrderItem[] = [{ type: "outdoor" }];
const EMPTY_DEVICE_IDS: readonly number[] = [];
const EMPTY_DEVICE_NAMES: Record<number, string> = {};
/** このパネルが開いた時点で必ず表示する線（グローバル設定より優先） */
const OUTDOOR_PANEL_FORCED_VISIBLE_KEYS: readonly string[] = CHART_METRICS.map(
  (metric) => outdoorMetricVisibilityKey(metric)
);

interface OutdoorDetailPanelProps {
  open: boolean;
  locationName?: string;
  /** 最初に選んでおく地点。ダッシュボードで押した屋外カードの地点が入る（#321） */
  initialLocationId?: string | null;
  /** カードから外した気圧を「いまの値」として出すための最新データ（#226）。基準地点のもの */
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
  initialLocationId = null,
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
  // 登録地点の一覧（#308）。オフライン時は切り替えを提供しない
  const [locations, setLocations] = useState<OutdoorLocationEntry[] | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedWeather, setSelectedWeather] = useState<OutdoorLocationWeather | null>(null);

  useEffect(() => {
    if (!open) return;
    setChartMetric("temperature");
    setViewRange("day");
    setSelectedLocationId(initialLocationId);
    setSelectedWeather(null);
    if (isOfflineMode) {
      setLocations(null);
      return;
    }
    let cancelled = false;
    void fetchOutdoorLocations()
      .then((list) => {
        if (cancelled) return;
        setLocations(list);
        // 押したカードの地点を選ぶ。消えていたら基準地点へ戻す
        const requested = initialLocationId
          ? list.find((loc) => loc.id === initialLocationId)
          : null;
        const primary = list.find((loc) => loc.is_primary) ?? list[0] ?? null;
        setSelectedLocationId((requested ?? primary)?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setLocations(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isOfflineMode, initialLocationId]);

  const primaryLocationId = useMemo(
    () => locations?.find((loc) => loc.is_primary)?.id ?? null,
    [locations]
  );
  const isPrimarySelected =
    selectedLocationId == null || selectedLocationId === primaryLocationId;
  const selectedLocation = useMemo(
    () => locations?.find((loc) => loc.id === selectedLocationId) ?? null,
    [locations, selectedLocationId]
  );

  // 基準地点以外を選んだときだけ、その地点の「いまの天気」を取りに行く
  // （選択が基準地点のときは selectedWeather を読まないので、明示的なクリアは不要）
  useEffect(() => {
    if (!open || isPrimarySelected || !selectedLocationId) return;
    let cancelled = false;
    void fetchOutdoorLocationWeather(selectedLocationId)
      .then((data) => {
        if (!cancelled) setSelectedWeather(data);
      })
      .catch(() => {
        if (!cancelled) setSelectedWeather(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isPrimarySelected, selectedLocationId]);

  // パネルを開いた時点では outdoor ラインを常に表示する(グローバル設定に関わらず)。
  // 開いたあとの凡例の目のアイコンはパネル内でだけ効く（#357）
  const { lineVisibility, handleLineVisibilityChange } = usePanelLineVisibility(
    lineVisibilityProp,
    OUTDOOR_PANEL_FORCED_VISIBLE_KEYS,
    onLineVisibilityChange
  );

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
    locationId: isPrimarySelected ? null : selectedLocationId,
  });

  if (!open) return null;

  const displayName = selectedLocation?.name ?? locationName;
  const readingsSource: LatestData | null = isPrimarySelected
    ? latest
    : selectedWeather
      ? {
          outdoor_temperature: selectedWeather.temperature ?? undefined,
          outdoor_humidity: selectedWeather.humidity ?? undefined,
          outdoor_pressure: selectedWeather.pressure ?? undefined,
        }
      : null;
  const weatherLabel = isPrimarySelected
    ? latest?.outdoor_weather_label
    : selectedWeather?.weather_label;
  const weatherIconKey = isPrimarySelected
    ? latest?.outdoor_weather_icon
    : selectedWeather?.weather_icon;
  const measuredAt = isPrimarySelected ? latest?.datetime : selectedWeather?.observed_at ?? undefined;

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[88vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">
              {formatOutdoorApiLabel(displayName)}
            </h2>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              {weatherLabel ? (
                <>
                  <WeatherIcon
                    icon={weatherIconKey}
                    className="size-3.5 shrink-0"
                    strokeWidth={1.75}
                  />
                  {weatherLabel} ・
                </>
              ) : null}
              Open-Meteo API
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

        {locations && locations.length > 1 ? (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-4 py-2.5 [-webkit-overflow-scrolling:touch]">
            {locations.map((loc) => (
              <button
                key={loc.id}
                type="button"
                onClick={() => setSelectedLocationId(loc.id)}
                className={
                  loc.id === selectedLocationId
                    ? "shrink-0 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-bold text-background"
                    : "shrink-0 rounded-full bg-muted px-3.5 py-1.5 text-xs font-bold text-muted-foreground hover:bg-accent"
                }
              >
                {loc.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
          <CurrentReadings
            readings={buildOutdoorReadings(readingsSource)}
            measuredAt={measuredAt}
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
              outdoorLocationName={displayName}
              chartColors={chartColors}
              lineVisibility={lineVisibility}
              onLineVisibilityChange={handleLineVisibilityChange}
              pinMetricTabsOnMobile={false}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
