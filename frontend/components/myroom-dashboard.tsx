"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ChevronRight, CloudSun, LineChart, RefreshCw, Settings } from "lucide-react";
import { LoginScreen } from "@/components/login-screen";
import { METRIC_ICONS } from "@/components/current-readings";
import { TrendPanel } from "@/components/trend-panel";
import { ComingSoonCard } from "@/components/coming-soon-card";
import { GarbageCard } from "@/components/garbage-card";
import { CleanerCard } from "@/components/cleaner-card";
import { PowerCard } from "@/components/power-card";
import { RemoteCard } from "@/components/remote-card";
import { PowerDetailPanel } from "@/components/power-detail-panel";
import { OutdoorDetailPanel } from "@/components/outdoor-detail-panel";
import { VersionHistoryDialog } from "@/components/version-history-dialog";
import { AirconControlPanel } from "@/components/aircon-control-panel";
import { Button } from "@/components/ui/button";
import {
  fetchDashboardData,
  fetchDevices,
  fetchCleanerSummary,
  fetchEnergyBreakdown,
  fetchGarbageSchedule,
  fetchOutdoorLocation,
  fetchAirconUnitsResponse,
  fetchRemoteButtons,
  fetchSensorsStatus,
} from "@/lib/api";
import {
  buildDashboardOfflineSnapshot,
  getLatestDataTimestamp,
  isOffline,
  loadDashboardOfflineSnapshot,
  saveDashboardOfflineSnapshot,
  type DashboardOfflineSnapshot,
} from "@/lib/offline-cache";
import { useChartHistory } from "@/lib/use-chart-history";
import {
  buildAirconReadings,
  buildIndoorReadings,
  buildOutdoorReadings,
  formatReading,
  pickCardReadings,
  type MetricReading,
} from "@/lib/device-metrics";
import {
  DISPLAY_ORDER_CHANGED_EVENT,
  buildDefaultDisplayOrder,
  type DisplayOrderItem,
} from "@/lib/display-order";
import {
  buildDefaultChartColors,
  CHART_COLORS_CHANGED_EVENT,
  getDeviceChartColor,
  type ChartColorSettings,
} from "@/lib/chart-colors";
import {
  buildDefaultChartLineVisibility,
  loadChartLineVisibility,
  saveChartLineVisibility,
  type ChartLineVisibilitySettings,
} from "@/lib/chart-line-visibility";
import {
  filterDisplayOrderByVisibility,
  getVisibleChartDeviceIds,
  getVisibleSensorDeviceIds,
  isAirconRoomVisible,
  isHiddenKeyVisible,
  applyHiddenDevicesToLineVisibility,
  VISIBLE_DEVICES_CHANGED_EVENT,
} from "@/lib/visible-devices";
import {
  COMING_SOON_CARDS,
  COMING_SOON_SECTION_KEY,
  DASHBOARD_SECTION_LABELS,
  CLEANER_CARD_KEY,
  ENERGY_CARD_KEY,
  GARBAGE_CARD_KEY,
  REMOTE_CARD_KEY,
} from "@/lib/dashboard-sections";
import type { GarbageSchedule } from "@/lib/garbage";
import type { RemoteButtons } from "@/lib/remote";
import { STALE_ALERT_EXCLUDED_CHANGED_EVENT } from "@/components/device-visibility-page";
import {
  loadUiSettingsFromServer,
  getDefaultUiSettings,
} from "@/lib/ui-settings-client";
import {
  applyDailyStatsInheritance,
  getLocationName,
  isPredecessorDevice,
} from "@/lib/device-inheritance";
import { AuthError } from "@/lib/auth";
import { supabase } from "@/lib/supabase-client";
import { useAuthState } from "@/lib/use-auth";
import { APP_VERSION } from "@/lib/app-version";
import {
  AIRCON_CHART_DEVICE_ID,
  buildAirconStatusPill,
  hasAirconData,
  getSensorDeviceIds,
  formatOutdoorApiLabel,
  pickOutdoorLatestSource,
  PRIMARY_SENSOR_DEVICE_ID,
  resolveAirconDataLoadStatus,
  resolveLatestDataLoadStatus,
  resolveOutdoorBatchLoadStatus,
  type AirconControlState,
  type AirconData,
  type AirconUnitInfo,
  type ChartMetric,
  type CleanerSummary,
  type ChartViewRange,
  type DailyStat,
  type DeviceDataLoadStatus,
  type DeviceInfo,
  type EnergyBreakdown,
  type LatestData,
  type OutdoorLocation,
  type SensorDeviceStatus,
} from "@/lib/types";

const DeviceDetailPanel = dynamic(
  () =>
    import("@/components/device-detail-panel").then((module) => module.DeviceDetailPanel),
  { ssr: false }
);

interface DeviceCardProps {
  title: string;
  readings: readonly MetricReading[];
  metricsState: MetricsDisplayState;
  accentColor?: string;
  action?: React.ReactNode;
  onClick?: () => void;
  statusNote?: string;
  /** 計測値の下に出す状態の表示（エアコンの運転状態など） */
  badge?: React.ReactNode;
  /** 見出しの左に出すアイコン（屋外など、アクセント色を持たないカード用） */
  titleIcon?: React.ReactNode;
}

type MetricsDisplayState = "loading" | "error" | "empty" | "ready";

function resolveMetricsDisplayState(
  readings: readonly MetricReading[],
  loadStatus: DeviceDataLoadStatus | undefined,
  dashboardDataLoaded: boolean
): MetricsDisplayState {
  if (readings.length > 0) return "ready";
  if (!dashboardDataLoaded) return "loading";
  if (loadStatus === "error") return "error";
  return "empty";
}

function metricsStateMessage(state: MetricsDisplayState): string {
  switch (state) {
    case "loading":
      return "読み込み中...";
    case "error":
      return "データを読み込めませんでした";
    case "empty":
      return "データがありません";
    default:
      return "";
  }
}

function DeviceCardSkeleton() {
  return (
    <div className="device-card-compact text-left" aria-hidden="true">
      <div className="mb-2.5 h-5 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-7 w-3/5 animate-pulse rounded bg-muted" />
    </div>
  );
}

function buildLoadStatusFromLatest(
  latestByDevice: Record<number, LatestData | null>,
  deviceIds: readonly number[]
): Record<number, DeviceDataLoadStatus> {
  const status: Record<number, DeviceDataLoadStatus> = {};
  for (const deviceId of deviceIds) {
    status[deviceId] = resolveLatestDataLoadStatus(latestByDevice[deviceId], false);
  }
  return status;
}

/**
 * 「いまの部屋」のカード。
 *
 * 計測値は先頭2つだけを出す（`pickCardReadings`）。1つ目を大きく、2つ目を右へ添えて
 * 高さを1行に収める。気圧・CO2・照度は詳細パネルの「いまの値」が受け持つ（#226）。
 */
function DeviceCard({
  title,
  readings,
  metricsState,
  accentColor,
  action,
  onClick,
  statusNote,
  badge,
  titleIcon,
}: DeviceCardProps) {
  const className = onClick
    ? "device-card-compact cursor-pointer text-left transition-transform active:scale-[0.98]"
    : "device-card-compact text-left";
  const cardStyle = accentColor
    ? ({ borderLeft: `4px solid ${accentColor}` } satisfies CSSProperties)
    : undefined;
  const [primary, ...secondary] = readings;
  const content = (
    <>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <p
          className="device-card-title flex min-w-0 flex-1 items-center gap-1.5"
          style={accentColor ? { color: accentColor } : undefined}
        >
          {titleIcon}
          <span className="min-w-0 truncate">{title}</span>
        </p>
        {action && <div className="flex shrink-0 items-center">{action}</div>}
      </div>
      {statusNote && (
        <p className="mb-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
          {statusNote}
        </p>
      )}
      {metricsState === "ready" ? (
        <div className="flex flex-col gap-2">
          {primary && (
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="device-card-value">
                {primary.text}
                <span className="device-card-unit">
                  {primary.unit === "°C" || primary.unit === "%"
                    ? primary.unit
                    : ` ${primary.unit}`}
                </span>
              </span>
              {secondary.map((reading) => {
                const Icon = METRIC_ICONS[reading.metric];
                return (
                  <span key={reading.metric} className="device-card-sub">
                    <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
                    {formatReading(reading)}
                  </span>
                );
              })}
            </div>
          )}
          {badge}
        </div>
      ) : (
        <p
          className={`text-sm ${
            metricsState === "error"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {metricsStateMessage(metricsState)}
        </p>
      )}
    </>
  );

  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onClick();
          }
        }}
        className={className}
        style={cardStyle}
      >
        {content}
      </div>
    );
  }

  return (
    <div className={className} style={cardStyle}>
      {content}
    </div>
  );
}

export function MyRoomDashboard() {
  const { isAuthenticated, setIsAuthenticated } = useAuthState();
  const [latestData, setLatestData] = useState<LatestData | null>(null);
  const [latestByDevice, setLatestByDevice] = useState<Record<number, LatestData | null>>(
    {}
  );
  const [dailyStatsByDevice, setDailyStatsByDevice] = useState<
    Record<number, DailyStat[]>
  >({});
  const [refreshing, setRefreshing] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("temperature");
  const [viewRange, setViewRange] = useState<ChartViewRange>("day");
  const [dailyLimit, setDailyLimit] = useState(7);
  const [outdoorLocation, setOutdoorLocation] = useState<OutdoorLocation | null>(null);
  const [outdoorPanelOpen, setOutdoorPanelOpen] = useState(false);
  const [trendPanelOpen, setTrendPanelOpen] = useState(false);
  const [devicePanelOpen, setDevicePanelOpen] = useState(false);
  const [devicePanelId, setDevicePanelId] = useState(PRIMARY_SENSOR_DEVICE_ID);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [sensorStatuses, setSensorStatuses] = useState<SensorDeviceStatus[]>([]);
  const [garbageSchedule, setGarbageSchedule] = useState<GarbageSchedule | null>(null);
  const [garbageError, setGarbageError] = useState(false);
  const [remoteButtons, setRemoteButtons] = useState<RemoteButtons | null>(null);
  const [remoteError, setRemoteError] = useState(false);
  const [energyBreakdown, setEnergyBreakdown] = useState<EnergyBreakdown | null>(null);
  const [energyError, setEnergyError] = useState(false);
  const [cleanerSummary, setCleanerSummary] = useState<CleanerSummary | null>(null);
  const [cleanerError, setCleanerError] = useState(false);
  const [energyPanelOpen, setEnergyPanelOpen] = useState(false);
  const [staleAlertDismissed, setStaleAlertDismissed] = useState(false);
  const [staleAlertExcludedKeys, setStaleAlertExcludedKeys] = useState<Set<string>>(() => new Set());
  const [displayOrder, setDisplayOrder] = useState<DisplayOrderItem[]>(() =>
    buildDefaultDisplayOrder()
  );
  const [hiddenDeviceKeys, setHiddenDeviceKeys] = useState<Set<string>>(() => new Set());
  const [chartColors, setChartColors] = useState<ChartColorSettings>(() =>
    buildDefaultChartColors()
  );
  const [defaultLineVisibility, setDefaultLineVisibility] =
    useState<ChartLineVisibilitySettings>(() => buildDefaultChartLineVisibility());

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [airconLatest, setAirconLatest] = useState<AirconData | null>(null);
  const [airconUnits, setAirconUnits] = useState<AirconUnitInfo[]>([]);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [offlineSnapshot, setOfflineSnapshot] = useState<DashboardOfflineSnapshot | null>(
    null
  );
  const [layoutReady, setLayoutReady] = useState(false);
  const [dashboardDataLoaded, setDashboardDataLoaded] = useState(false);
  const [latestLoadStatusByDevice, setLatestLoadStatusByDevice] = useState<
    Record<number, DeviceDataLoadStatus>
  >({});
  const [airconLoadStatus, setAirconLoadStatus] = useState<DeviceDataLoadStatus>("empty");
  // 白くまくんのログイン情報がバックエンドに無ければ操作パネルを出さない（#213）
  const [airconControlEnabled, setAirconControlEnabled] = useState(false);
  const [airconControlOpen, setAirconControlOpen] = useState(false);

  const activeAirconId = airconLatest?.ac_id ?? 1;
  const airconChartTitle =
    airconLatest?.name ??
    airconUnits.find((unit) => unit.ac_id === activeAirconId)?.name ??
    "エアコン";

  const sensorDeviceIds = useMemo(() => getSensorDeviceIds(devices), [devices]);

  const effectiveLineVisibility = useMemo(
    () =>
      applyHiddenDevicesToLineVisibility(
        defaultLineVisibility,
        hiddenDeviceKeys,
        sensorDeviceIds
      ),
    [defaultLineVisibility, hiddenDeviceKeys, sensorDeviceIds]
  );

  const visibleSensorDeviceIds = useMemo(
    () => getVisibleSensorDeviceIds(sensorDeviceIds, hiddenDeviceKeys),
    [sensorDeviceIds, hiddenDeviceKeys]
  );

  const chartDeviceIds = useMemo(
    () => getVisibleChartDeviceIds(sensorDeviceIds, hiddenDeviceKeys),
    [sensorDeviceIds, hiddenDeviceKeys]
  );

  const visibleDisplayOrder = useMemo(
    () => filterDisplayOrderByVisibility(displayOrder, hiddenDeviceKeys),
    [displayOrder, hiddenDeviceKeys]
  );

  const remoteCardVisible = isHiddenKeyVisible(hiddenDeviceKeys, REMOTE_CARD_KEY);
  const garbageCardVisible = isHiddenKeyVisible(hiddenDeviceKeys, GARBAGE_CARD_KEY);
  const energyCardVisible = isHiddenKeyVisible(hiddenDeviceKeys, ENERGY_CARD_KEY);
  const cleanerCardVisible = isHiddenKeyVisible(hiddenDeviceKeys, CLEANER_CARD_KEY);
  const comingSoonVisible = isHiddenKeyVisible(hiddenDeviceKeys, COMING_SOON_SECTION_KEY);

  const {
    historyData,
    historyLoading,
    awaitingLatest,
    loadingRange,
    historyEpoch,
    noMoreOlderData,
    resetAndLoad,
    refreshLatest,
    ensureVisibleRangeLoaded,
  } = useChartHistory(visibleSensorDeviceIds, viewRange, {
    airconAcId: activeAirconId,
    airconChartDeviceId: AIRCON_CHART_DEVICE_ID,
    devices,
    pollIntervalMs: 30000,
    offlineMode: isOfflineMode,
    offlineHistory: offlineSnapshot?.historyData ?? null,
    offlineCacheKey: offlineSnapshot?.cachedAt ?? null,
  });

  const applyOfflineSnapshot = useCallback((snapshot: DashboardOfflineSnapshot) => {
    const sensorIds = getSensorDeviceIds(snapshot.devices);
    setLatestByDevice(snapshot.latestByDevice);
    setLatestData(snapshot.latestByDevice[PRIMARY_SENSOR_DEVICE_ID] ?? null);
    setDailyStatsByDevice(snapshot.dailyStatsByDevice);
    setAirconLatest(snapshot.airconLatest);
    setDevices(snapshot.devices);
    setAirconUnits(snapshot.airconUnits);
    setOutdoorLocation(snapshot.outdoorLocation);
    setLatestLoadStatusByDevice(
      buildLoadStatusFromLatest(snapshot.latestByDevice, sensorIds)
    );
    setAirconLoadStatus(resolveAirconDataLoadStatus(snapshot.airconLatest, false));
    setDashboardDataLoaded(true);
    setLayoutReady(true);
    setOfflineSnapshot(snapshot);
    setIsOfflineMode(true);
  }, []);

  const deviceNames = useMemo(() => {
    const names: Record<number, string> = {};
    for (const deviceId of sensorDeviceIds) {
      const device = devices.find((item) => item.id === deviceId);
      names[deviceId] =
        device?.name ??
        (deviceId === 1 ? "リビング" : deviceId === 2 ? "寝室" : `デバイス ${deviceId}`);
    }
    names[AIRCON_CHART_DEVICE_ID] = airconChartTitle;
    return names;
  }, [devices, sensorDeviceIds, airconChartTitle]);

  const reloadUiSettings = useCallback(async () => {
    try {
      const settings = await loadUiSettingsFromServer(sensorDeviceIds);
      setDisplayOrder(settings.displayOrder);
      setChartColors(settings.chartColors);
      setHiddenDeviceKeys(settings.hiddenDeviceKeys);
      setStaleAlertExcludedKeys(settings.staleAlertExcludedKeys);
    } catch (err) {
      if (err instanceof AuthError) {
        setIsAuthenticated(false);
      }
    }
  }, [sensorDeviceIds, setIsAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLayoutReady(false);
      setDashboardDataLoaded(false);
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      try {
        const [deviceList, airconUnitsResponse, outdoorLoc] = await Promise.all([
          fetchDevices().catch(() => [] as DeviceInfo[]),
          fetchAirconUnitsResponse().catch(() => ({
            units: [] as AirconUnitInfo[],
            control_enabled: false,
          })),
          fetchOutdoorLocation().catch(() => null),
        ]);
        if (cancelled) return;

        const sensorIds = getSensorDeviceIds(deviceList);
        let settings;
        try {
          settings = await loadUiSettingsFromServer(sensorIds);
        } catch (err) {
          if (err instanceof AuthError) {
            setIsAuthenticated(false);
            return;
          }
          settings = getDefaultUiSettings(sensorIds);
        }
        if (cancelled) return;

        setDevices(deviceList);
        setAirconUnits(airconUnitsResponse.units);
        setAirconControlEnabled(airconUnitsResponse.control_enabled);
        setOutdoorLocation(outdoorLoc);
        setDisplayOrder(settings.displayOrder);
        setChartColors(settings.chartColors);
        setHiddenDeviceKeys(settings.hiddenDeviceKeys);
        setStaleAlertExcludedKeys(settings.staleAlertExcludedKeys);
        setDefaultLineVisibility(loadChartLineVisibility(sensorIds));
        setLayoutReady(true);
      } catch {
        if (!cancelled) setLayoutReady(true);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, setIsAuthenticated]);

  useEffect(() => {
    const reloadVisibility = () => {
      void reloadUiSettings();
    };
    const reloadChartColors = () => {
      void reloadUiSettings();
    };

    window.addEventListener(VISIBLE_DEVICES_CHANGED_EVENT, reloadVisibility);
    window.addEventListener(CHART_COLORS_CHANGED_EVENT, reloadChartColors);
    window.addEventListener(DISPLAY_ORDER_CHANGED_EVENT, reloadVisibility);
    window.addEventListener(STALE_ALERT_EXCLUDED_CHANGED_EVENT, reloadVisibility);
    return () => {
      window.removeEventListener(VISIBLE_DEVICES_CHANGED_EVENT, reloadVisibility);
      window.removeEventListener(CHART_COLORS_CHANGED_EVENT, reloadChartColors);
      window.removeEventListener(DISPLAY_ORDER_CHANGED_EVENT, reloadVisibility);
      window.removeEventListener(STALE_ALERT_EXCLUDED_CHANGED_EVENT, reloadVisibility);
    };
  }, [reloadUiSettings]);

  /** 単価を変えたあとの再集計。金額はサーバー側で単価を掛けているため取り直す */
  const refreshEnergyBreakdown = useCallback(async () => {
    try {
      const breakdown = await fetchEnergyBreakdown();
      setEnergyBreakdown(breakdown);
      setEnergyError(false);
    } catch {
      setEnergyError(true);
    }
  }, []);

  const fetchData = useCallback(
    async (options?: { showChartLoading?: boolean; reloadHistory?: boolean }) => {
      const showChartLoading = options?.showChartLoading ?? false;
      const reloadHistory = options?.reloadHistory ?? false;
      setRefreshing(true);
      if (showChartLoading) setChartLoading(true);
      try {
        if (isOffline()) {
          const snapshot = await loadDashboardOfflineSnapshot();
          if (snapshot) {
            applyOfflineSnapshot(snapshot);
            return;
          }
        }

        const [data, sensorsStatus, garbage, energy, remote, cleaner] = await Promise.all([
          fetchDashboardData(airconLatest?.ac_id ?? 1, visibleSensorDeviceIds, devices),
          fetchSensorsStatus().catch(() => null),
          fetchGarbageSchedule().catch(() => null),
          fetchEnergyBreakdown().catch(() => null),
          fetchRemoteButtons().catch(() => null),
          fetchCleanerSummary().catch(() => null),
        ]);
        setIsOfflineMode(false);
        setOfflineSnapshot(null);
        setLatestByDevice(data.latestByDevice);
        setLatestData(data.latest);
        setDailyStatsByDevice(data.dailyStatsByDevice);
        setAirconLatest(data.airconLatest);
        setLatestLoadStatusByDevice(data.latestLoadStatusByDevice);
        setAirconLoadStatus(data.airconLoadStatus);
        if (sensorsStatus) {
          setSensorStatuses(sensorsStatus.devices);
          setStaleAlertDismissed(false);
        }
        // 取得できなかったときは直前の内容を残したまま、エラー表示だけを出す
        if (garbage) setGarbageSchedule(garbage);
        setGarbageError(garbage == null);
        if (energy) setEnergyBreakdown(energy);
        setEnergyError(energy == null);
        if (remote) setRemoteButtons(remote);
        setRemoteError(remote == null);
        if (cleaner) setCleanerSummary(cleaner);
        setCleanerError(cleaner == null);
        if (reloadHistory) {
          await resetAndLoad();
        }
      } catch (err) {
        if (err instanceof AuthError) {
          setIsAuthenticated(false);
          return;
        }
        console.error(err);
        const snapshot = await loadDashboardOfflineSnapshot();
        if (snapshot) {
          applyOfflineSnapshot(snapshot);
        } else {
          setLatestLoadStatusByDevice((prev) => {
            const next = { ...prev };
            for (const deviceId of visibleSensorDeviceIds) {
              next[deviceId] = "error";
            }
            return next;
          });
          setAirconLoadStatus("error");
        }
      } finally {
        setDashboardDataLoaded(true);
        setRefreshing(false);
        if (showChartLoading) setChartLoading(false);
      }
    },
    [
      resetAndLoad,
      airconLatest?.ac_id,
      visibleSensorDeviceIds,
      devices,
      applyOfflineSnapshot,
      setIsAuthenticated,
    ]
  );

  useEffect(() => {
    if (!isAuthenticated || isOfflineMode || isOffline()) return;
    if (!historyData.length || Object.keys(latestByDevice).length === 0) return;

    const snapshot = buildDashboardOfflineSnapshot({
      sensorDeviceIds,
      airconAcId: activeAirconId,
      latestByDevice,
      dailyStatsByDevice,
      airconLatest,
      historyData,
      devices,
      airconUnits,
      outdoorLocation,
    });

    if (!snapshot) return;
    void saveDashboardOfflineSnapshot(snapshot);
  }, [
    isAuthenticated,
    isOfflineMode,
    sensorDeviceIds,
    activeAirconId,
    latestByDevice,
    dailyStatsByDevice,
    airconLatest,
    historyData,
    devices,
    airconUnits,
    outdoorLocation,
  ]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleOnline = () => {
      setIsOfflineMode(false);
      setOfflineSnapshot(null);
      void fetchData({ showChartLoading: true });
      void refreshLatest();
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [isAuthenticated, fetchData, refreshLatest]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fetchData({ showChartLoading: true });
        void refreshLatest();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isAuthenticated, fetchData, refreshLatest]);

  useEffect(() => {
    if (!isAuthenticated || !layoutReady) return;
    fetchData();
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [isAuthenticated, layoutReady, fetchData]);

  const handleLogout = () => {
    setIsAuthenticated(false);
    void supabase.auth.signOut();
  };

  const mergedDailyStatsByDevice = useMemo(
    () => applyDailyStatsInheritance(dailyStatsByDevice, sensorDeviceIds, devices),
    [dailyStatsByDevice, sensorDeviceIds, devices]
  );

  const maxDailyStatsDays = useMemo(() => {
    const dates = new Set<string>();
    for (const deviceId of [...sensorDeviceIds, AIRCON_CHART_DEVICE_ID]) {
      for (const day of mergedDailyStatsByDevice[deviceId] ?? []) {
        dates.add(String(day.date).slice(0, 10));
      }
    }
    return dates.size;
  }, [mergedDailyStatsByDevice, sensorDeviceIds]);

  const dailyStatsDeviceIds = useMemo(() => {
    const ids: number[] = [];
    for (const item of visibleDisplayOrder) {
      if (item.type === "device" && !isPredecessorDevice(item.deviceId, devices)) {
        ids.push(item.deviceId);
      } else if (
        item.type === "aircon" &&
        isAirconRoomVisible(hiddenDeviceKeys) &&
        (mergedDailyStatsByDevice[AIRCON_CHART_DEVICE_ID]?.length ?? 0) > 0
      ) {
        ids.push(AIRCON_CHART_DEVICE_ID);
      }
    }
    return ids;
  }, [visibleDisplayOrder, mergedDailyStatsByDevice, devices, hiddenDeviceKeys]);

  /**
   * 操作パネルでの送信が成功したとき、カードの表示も合わせる。
   *
   * **DBへ入るのはラズパイの取り込み待ち（5分ごと）。** それを待つと、操作した直後だけ
   * カードが古い状態を出し続けることになる。
   */
  const handleAirconControlApplied = useCallback((next: AirconControlState) => {
    setAirconLatest((prev) => ({
      ...(prev ?? {}),
      ac_id: next.ac_id,
      name: next.name ?? prev?.name,
      power: next.power,
      mode: next.mode,
      target_temperature: next.target_temperature ?? undefined,
      room_temperature: next.room_temperature ?? prev?.room_temperature,
      humidity: next.humidity ?? prev?.humidity,
      fan_speed: next.fan_speed,
      fan_swing: next.fan_swing,
    }));
    setAirconLoadStatus("ok");
  }, []);

  const handleChartLineVisibleChange = (key: string, visible: boolean) => {
    setDefaultLineVisibility((prev) => {
      const next = { ...prev, [key]: visible };
      saveChartLineVisibility(next);
      return next;
    });
  };

  const latestForDailyStats = useMemo(() => {
    const merged = { ...latestByDevice };
    if (airconLatest?.room_temperature != null) {
      merged[AIRCON_CHART_DEVICE_ID] = {
        device_id: AIRCON_CHART_DEVICE_ID,
        datetime: airconLatest.datetime,
        temperature: airconLatest.room_temperature,
      };
    }
    return merged;
  }, [latestByDevice, airconLatest]);

  const staleByDevice = useMemo(() => {
    const map = new Map<number, SensorDeviceStatus>();
    for (const status of sensorStatuses) {
      map.set(status.device_id, status);
    }
    return map;
  }, [sensorStatuses]);

  const monitoredStaleStatuses = useMemo(
    () => sensorStatuses.filter((s) => s.stale && !staleAlertExcludedKeys.has(`device:${s.device_id}`)),
    [sensorStatuses, staleAlertExcludedKeys]
  );

  const hasStaleSensors = monitoredStaleStatuses.length > 0;

  const staleDeviceNames = useMemo(
    () => monitoredStaleStatuses.map((s) => `${s.name}（ID:${s.device_id}）`),
    [monitoredStaleStatuses]
  );

  const formatStaleNote = (deviceId: number): string | undefined => {
    const status = staleByDevice.get(deviceId);
    if (!status?.stale) return undefined;
    if (!status.has_data) return "データ未受信";
    if (status.age_minutes != null) {
      return `約${Math.round(status.age_minutes)}分間データなし`;
    }
    return "データ未到達";
  };

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  const getDeviceInfo = (deviceId: number): DeviceInfo =>
    devices.find((device) => device.id === deviceId) ?? {
      id: deviceId,
      name: deviceNames[deviceId] ?? `デバイス ${deviceId}`,
    };

  const outdoorLatest = pickOutdoorLatestSource(latestByDevice);
  const outdoorReadings = buildOutdoorReadings(outdoorLatest);
  const airconTitle = airconChartTitle;
  const lastUpdatedMs = getLatestDataTimestamp(latestByDevice, airconLatest);
  const lastUpdated =
    lastUpdatedMs != null
      ? new Date(lastUpdatedMs).toLocaleString("ja-JP", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "--";
  const offlineCachedAt = offlineSnapshot?.dataLatestAt
    ? new Date(offlineSnapshot.dataLatestAt).toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-[480px] pb-10 lg:max-w-[1040px]">
      <div className="space-y-6 px-5 pt-12 lg:px-8">
        {isOfflineMode && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            オフライン表示中
            {offlineCachedAt ? `（${offlineCachedAt} 時点・直近24時間）` : "（直近24時間）"}
          </div>
        )}
        {hasStaleSensors && !isOfflineMode && !staleAlertDismissed && (
          <div className="relative rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 pr-10 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            <p>
              センサーからのデータがしばらく届いていません（{staleDeviceNames.join("・")}）。通知設定からプッシュ通知を有効にできます。
            </p>
            <button
              onClick={() => setStaleAlertDismissed(true)}
              className="absolute right-2 top-2 rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
              aria-label="通知を閉じる"
            >
              ✕
            </button>
          </div>
        )}
        <header className="flex items-center justify-between gap-3 px-0.5">
          <div>
            <h1 className="section-title">MyRoom</h1>
            <p className="section-subtitle">最終更新: {lastUpdated}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (isOfflineMode) return;
                fetchData({ showChartLoading: true });
                void refreshLatest();
              }}
              disabled={isOfflineMode}
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="更新"
            >
              <RefreshCw className={`size-5 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {/*
          上段に「いまの部屋」、下段に暮らし。センサーの計測値を2つへ絞ってカードが
          低くなったため、いまの状態をひと目で見せる位置へ上げた（#226）。
          PCは上段を4列、下段を2列にして、左右の列の長さが極端に食い違わないようにする。
        */}
        <div className="space-y-6">
          <section>
            <div className="mb-3 flex items-center justify-between gap-2 px-0.5">
              <h2 className="section-title">{DASHBOARD_SECTION_LABELS.sensors}</h2>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setTrendPanelOpen(true)}
                  className="flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-bold text-foreground transition-colors hover:bg-accent"
                >
                  <LineChart className="size-4" strokeWidth={1.75} />
                  推移
                </button>
                <Link
                  href="/devices"
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Settings className="size-4" strokeWidth={1.75} />
                  表示設定
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {!layoutReady
                ? buildDefaultDisplayOrder().map((_, index) => (
                    <DeviceCardSkeleton key={`device-skeleton-${index}`} />
                  ))
                : visibleDisplayOrder.map((item) => {
                if (item.type === "device") {
                  const deviceId = item.deviceId;
                  const device = getDeviceInfo(deviceId);
                  const accentColor = getDeviceChartColor(chartColors, deviceId);
                  const indoorReadings = buildIndoorReadings(latestByDevice[deviceId]);
                  return (
                    <DeviceCard
                      key={`device-${deviceId}`}
                      title={device.name}
                      accentColor={accentColor}
                      action={
                        <ChevronRight
                          className="size-5 shrink-0 text-muted-foreground/60"
                          strokeWidth={1.75}
                        />
                      }
                      onClick={() => {
                        setDevicePanelId(deviceId);
                        setDevicePanelOpen(true);
                      }}
                      readings={pickCardReadings(indoorReadings)}
                      metricsState={resolveMetricsDisplayState(
                        indoorReadings,
                        latestLoadStatusByDevice[deviceId],
                        dashboardDataLoaded
                      )}
                      statusNote={formatStaleNote(deviceId)}
                    />
                  );
                }

                if (item.type === "outdoor") {
                  const outdoorLoadStatus = resolveOutdoorBatchLoadStatus(
                    latestByDevice,
                    latestLoadStatusByDevice
                  );
                  return (
                    <DeviceCard
                      key="outdoor"
                      title={formatOutdoorApiLabel(outdoorLocation?.name)}
                      titleIcon={
                        <CloudSun
                          className="size-4 shrink-0 text-muted-foreground"
                          strokeWidth={1.75}
                        />
                      }
                      readings={pickCardReadings(outdoorReadings)}
                      metricsState={resolveMetricsDisplayState(
                        outdoorReadings,
                        outdoorLoadStatus,
                        dashboardDataLoaded
                      )}
                      action={
                        <ChevronRight
                          className="size-5 shrink-0 text-muted-foreground/60"
                          strokeWidth={1.75}
                        />
                      }
                      onClick={() => setOutdoorPanelOpen(true)}
                    />
                  );
                }

                // 室温だけをカードに出す。運転モードと設定温度はバッジが持っており、
                // 計測値にも同じ文字列を並べると同じことを2回言うことになる（#226）
                const airconReadings = isAirconRoomVisible(hiddenDeviceKeys)
                  ? buildAirconReadings(airconLatest?.room_temperature)
                  : [];
                // 操作できるときだけ開けるようにする。ログイン情報が無いバックエンドでは
                // パネルを開いても何も操作できないため、入口ごと出さない（#213）
                const airconControllable = airconControlEnabled && !isOfflineMode;
                const airconPill = buildAirconStatusPill(airconLatest);
                const airconState = resolveMetricsDisplayState(
                  airconReadings,
                  airconLoadStatus,
                  dashboardDataLoaded
                );
                return (
                  <DeviceCard
                    key="aircon"
                    title={airconTitle}
                    accentColor={getDeviceChartColor(chartColors, AIRCON_CHART_DEVICE_ID)}
                    badge={
                      airconPill.color ? (
                        <span
                          className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold"
                          style={{
                            color: airconPill.color,
                            backgroundColor: `${airconPill.color}24`,
                          }}
                        >
                          <span
                            className="size-1.5 rounded-full bg-current"
                            aria-hidden
                          />
                          {airconPill.label}
                        </span>
                      ) : airconLatest ? (
                        <span className="inline-flex w-fit items-center rounded-full bg-muted px-2.5 py-0.5 text-[11.5px] font-bold text-muted-foreground">
                          {airconPill.label}
                        </span>
                      ) : null
                    }
                    action={
                      airconControllable ? (
                        <ChevronRight
                          className="size-5 shrink-0 text-muted-foreground/60"
                          strokeWidth={1.75}
                        />
                      ) : undefined
                    }
                    onClick={
                      airconControllable
                        ? () => setAirconControlOpen(true)
                        : undefined
                    }
                    readings={airconReadings}
                    // 室温が無くても運転状態のバッジが出ているなら「データがありません」とは言わない
                    metricsState={
                      airconState !== "ready" && hasAirconData(airconLatest)
                        ? "ready"
                        : airconState
                    }
                  />
                );
              })}
            </div>
          </section>

          {(remoteCardVisible || garbageCardVisible || energyCardVisible || cleanerCardVisible) && (
            <section>
              <div className="mb-3 px-0.5">
                <h2 className="section-title">{DASHBOARD_SECTION_LABELS.life}</h2>
              </div>
              <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:items-start">
                {remoteCardVisible && (
                  <RemoteCard
                    buttons={remoteButtons}
                    loading={!dashboardDataLoaded && remoteButtons == null}
                    error={remoteError && remoteButtons == null}
                  />
                )}
                {garbageCardVisible && (
                  <GarbageCard
                    schedule={garbageSchedule}
                    loading={!dashboardDataLoaded && garbageSchedule == null}
                    error={garbageError && garbageSchedule == null}
                  />
                )}
                {energyCardVisible && (
                  <PowerCard
                    breakdown={energyBreakdown}
                    loading={!dashboardDataLoaded && energyBreakdown == null}
                    error={energyError && energyBreakdown == null}
                    onOpenDetail={() => setEnergyPanelOpen(true)}
                  />
                )}
                {cleanerCardVisible && (
                  <CleanerCard
                    summary={cleanerSummary}
                    loading={!dashboardDataLoaded && cleanerSummary == null}
                    error={cleanerError && cleanerSummary == null}
                  />
                )}
              </div>
            </section>
          )}

          {comingSoonVisible && COMING_SOON_CARDS.length > 0 && (
            <section>
              <div className="mb-3 px-0.5">
                <h2 className="section-title text-muted-foreground">
                  {DASHBOARD_SECTION_LABELS.comingSoon}
                </h2>
              </div>
              <div className="flex flex-col gap-2.5 lg:grid lg:grid-cols-2 lg:items-start">
                {COMING_SOON_CARDS.map((card) => (
                  <ComingSoonCard key={card.key} card={card} />
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex gap-2 pt-2 lg:max-w-[420px]">
          <Button
            variant="ghost"
            className="flex-1 text-muted-foreground"
            onClick={() => window.location.reload()}
          >
            画面再読み込み
          </Button>
          <Button
            variant="ghost"
            className="flex-1 text-[#e74c3c]"
            onClick={handleLogout}
          >
            ログアウト
          </Button>
        </div>
        <button
          type="button"
          onClick={() => setVersionHistoryOpen(true)}
          className="mx-auto block pt-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline lg:mx-0 lg:w-[420px]"
        >
          バージョン {APP_VERSION}
        </button>
      </div>

      <TrendPanel
        open={trendPanelOpen}
        onClose={() => setTrendPanelOpen(false)}
        historyData={historyData}
        chartDeviceIds={chartDeviceIds}
        deviceNames={deviceNames}
        chartMetric={chartMetric}
        onChartMetricChange={setChartMetric}
        viewRange={viewRange}
        onViewRangeChange={setViewRange}
        chartLoading={chartLoading}
        historyLoading={historyLoading || loadingRange}
        awaitingLatest={awaitingLatest}
        historyEpoch={historyEpoch}
        noMoreOlderData={noMoreOlderData}
        onVisibleDomainChange={ensureVisibleRangeLoaded}
        airconTargetDeviceId={AIRCON_CHART_DEVICE_ID}
        outdoorLocationName={outdoorLocation?.name}
        legendOrder={visibleDisplayOrder}
        chartColors={chartColors}
        lineVisibility={effectiveLineVisibility}
        onLineVisibilityChange={handleChartLineVisibleChange}
        dailyStatsByDevice={mergedDailyStatsByDevice}
        dailyStatsDeviceIds={dailyStatsDeviceIds}
        latestByDevice={latestForDailyStats}
        dailyLimit={dailyLimit}
        onLoadMoreDailyStats={() =>
          setDailyLimit((prev) => Math.min(prev + 7, maxDailyStatsDays))
        }
      />

      <DeviceDetailPanel
        open={devicePanelOpen}
        deviceId={devicePanelId}
        locationName={getLocationName(devicePanelId, devices, deviceNames)}
        latest={latestByDevice[devicePanelId] ?? null}
        chartColors={chartColors}
        lineVisibility={effectiveLineVisibility}
        devices={devices}
        isOfflineMode={isOfflineMode}
        offlineHistory={offlineSnapshot?.historyData ?? null}
        offlineCacheKey={offlineSnapshot?.cachedAt ?? null}
        onLineVisibilityChange={handleChartLineVisibleChange}
        onClose={() => setDevicePanelOpen(false)}
        onChanged={() => fetchData({ reloadHistory: true })}
      />

      {outdoorPanelOpen && (
        <OutdoorDetailPanel
          open={outdoorPanelOpen}
          locationName={outdoorLocation?.name}
          latest={outdoorLatest}
          chartColors={chartColors}
          lineVisibility={defaultLineVisibility}
          isOfflineMode={isOfflineMode}
          offlineHistory={offlineSnapshot?.historyData ?? null}
          offlineCacheKey={offlineSnapshot?.cachedAt ?? null}
          onLineVisibilityChange={handleChartLineVisibleChange}
          onClose={() => setOutdoorPanelOpen(false)}
        />
      )}

      {energyPanelOpen && (
        <PowerDetailPanel
          open={energyPanelOpen}
          breakdown={energyBreakdown}
          onClose={() => setEnergyPanelOpen(false)}
          onUnitPriceSaved={() => {
            void refreshEnergyBreakdown();
          }}
        />
      )}

      {airconControlOpen && (
        <AirconControlPanel
          acId={activeAirconId}
          title={airconTitle}
          onClose={() => setAirconControlOpen(false)}
          onApplied={handleAirconControlApplied}
        />
      )}

      <VersionHistoryDialog
        open={versionHistoryOpen}
        onClose={() => setVersionHistoryOpen(false)}
      />
    </div>
  );
}
