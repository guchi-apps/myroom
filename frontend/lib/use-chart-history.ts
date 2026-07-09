"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getViewRangeMs } from "@/lib/chart-utils";
import { fetchAirconHistoryWindow, fetchHistoryWindow } from "@/lib/api";
import {
  getHistoryChunkMs,
  getHistoryInitialSpanMs,
  getHistoryQuickInitialSpanMs,
  getLoadedRange,
  mergeAirconIntoHistory,
  mergeHistoryPoints,
  mergeMultiDeviceHistory,
} from "@/lib/history-loader";
import {
  loadDashboardOfflineSnapshot,
  type DashboardOfflineSnapshot,
} from "@/lib/offline-cache";
import {
  expandDeviceIdsForHistory,
  applyAllDeviceInheritance,
} from "@/lib/device-inheritance";
import type { ChartViewRange, DeviceInfo, HistoryPoint } from "@/lib/types";
import { AIRCON_CHART_DEVICE_ID } from "@/lib/types";

function isSnapshotCompatibleWithDevices(
  snapshot: DashboardOfflineSnapshot,
  deviceIds: readonly number[]
): boolean {
  const cached = new Set(snapshot.sensorDeviceIds);
  return deviceIds.length > 0 && deviceIds.every((id) => cached.has(id));
}

export interface UseChartHistoryOptions {
  airconAcId?: number | null;
  airconChartDeviceId?: number;
  /** 継承チェーン解決用のデバイス一覧 */
  devices?: readonly DeviceInfo[];
  /** グラフ履歴の自動更新間隔（ms）。0 で無効。既定 30 秒 */
  pollIntervalMs?: number;
  /** オフライン時に表示するキャッシュ済み履歴 */
  offlineHistory?: HistoryPoint[] | null;
  /** オフラインキャッシュの識別子（cachedAt など） */
  offlineCacheKey?: string | null;
  /** true の間はネットワークから履歴を読み込まない */
  offlineMode?: boolean;
}

export function useChartHistory(
  deviceIds: readonly number[],
  viewRange: ChartViewRange,
  options?: UseChartHistoryOptions
) {
  const airconAcId = options?.airconAcId ?? null;
  const airconChartDeviceId = options?.airconChartDeviceId ?? AIRCON_CHART_DEVICE_ID;
  const devices = options?.devices ?? [];
  const pollIntervalMs = options?.pollIntervalMs ?? 30000;
  const offlineHistory = options?.offlineHistory ?? null;
  const offlineCacheKey = options?.offlineCacheKey ?? null;
  const offlineMode = options?.offlineMode ?? false;
  const offlineHistoryRef = useRef<HistoryPoint[] | null>(null);
  offlineHistoryRef.current = offlineHistory;
  const devicesRef = useRef<readonly DeviceInfo[]>(devices);
  devicesRef.current = devices;

  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingRange, setLoadingRange] = useState(false);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [noMoreOlderData, setNoMoreOlderData] = useState(false);

  const loadedRangeRef = useRef<{ min: number; max: number } | null>(null);
  const loadingOlderRef = useRef(false);
  const loadingNewerRef = useRef(false);
  const loadingRangeCountRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const historyDataRef = useRef<HistoryPoint[]>([]);
  historyDataRef.current = historyData;
  const deviceIdsKey = deviceIds.join(",");
  const airconKey = airconAcId ?? "none";

  const fetchMergedWindow = useCallback(
    async (start: Date, end: Date) => {
      const fetchIds = expandDeviceIdsForHistory(deviceIds, devicesRef.current);
      const [sensorChunks, airconChunk] = await Promise.all([
        Promise.all(
          fetchIds.map((deviceId) =>
            fetchHistoryWindow(start, end, viewRange, deviceId)
          )
        ),
        airconAcId != null
          ? fetchAirconHistoryWindow(start, end, viewRange, airconAcId)
          : Promise.resolve([]),
      ]);
      const byDevice = Object.fromEntries(
        fetchIds.map((deviceId, index) => [deviceId, sensorChunks[index]])
      ) as Record<number, HistoryPoint[]>;
      let merged = mergeMultiDeviceHistory(byDevice);
      merged = applyAllDeviceInheritance(merged, deviceIds, devicesRef.current);

      if (airconChunk.length) {
        merged = mergeAirconIntoHistory(merged, airconChunk, airconChartDeviceId);
      }

      return merged;
    },
    [deviceIds, viewRange, airconAcId, airconChartDeviceId]
  );

  const resetAndLoad = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!historyDataRef.current.length) {
      setHistoryLoading(true);
    }
    setNoMoreOlderData(false);
    loadedRangeRef.current = null;

    const end = new Date();
    const fullSpanMs = getHistoryInitialSpanMs(viewRange);
    const quickSpanMs = Math.min(
      getHistoryQuickInitialSpanMs(viewRange),
      fullSpanMs
    );
    const quickStart = new Date(end.getTime() - quickSpanMs);

    try {
      const quickChunk = await fetchMergedWindow(quickStart, end);
      if (generation !== loadGenerationRef.current) return;

      setHistoryData(quickChunk);
      loadedRangeRef.current = getLoadedRange(quickChunk);
      setHistoryEpoch((epoch) => epoch + 1);
      setHistoryLoading(false);

      if (fullSpanMs > quickSpanMs) {
        const fullStart = new Date(end.getTime() - fullSpanMs);
        const olderChunk = await fetchMergedWindow(fullStart, quickStart);
        if (generation !== loadGenerationRef.current) return;

        if (olderChunk.length) {
          setHistoryData((prev) => {
            const merged = mergeHistoryPoints(prev, olderChunk);
            loadedRangeRef.current = getLoadedRange(merged);
            return merged;
          });
        }
      }
    } catch (err) {
      if (generation !== loadGenerationRef.current) return;
      console.error(err);
      if (!historyDataRef.current.length) {
        setHistoryData([]);
        loadedRangeRef.current = null;
      }
      setHistoryLoading(false);
    }
  }, [fetchMergedWindow, viewRange]);

  const hydrateFromCache = useCallback((points: HistoryPoint[]) => {
    setHistoryLoading(false);
    setNoMoreOlderData(true);
    setHistoryData(points);
    loadedRangeRef.current = points.length ? getLoadedRange(points) : null;
    setHistoryEpoch((epoch) => epoch + 1);
  }, []);

  useEffect(() => {
    if (offlineMode) {
      if (offlineHistoryRef.current?.length) {
        hydrateFromCache(offlineHistoryRef.current);
      }
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        const snapshot = await loadDashboardOfflineSnapshot();
        if (
          !cancelled &&
          snapshot?.historyData.length &&
          isSnapshotCompatibleWithDevices(snapshot, deviceIds)
        ) {
          setHistoryLoading(false);
          setHistoryData(snapshot.historyData);
          loadedRangeRef.current = getLoadedRange(snapshot.historyData);
        }
      } catch {
        // IndexedDB が使えない環境では無視
      }

      if (!cancelled) {
        await resetAndLoad();
      }
    }

    void init();
    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
    };
  }, [resetAndLoad, deviceIdsKey, airconKey, offlineMode, offlineCacheKey, hydrateFromCache, deviceIds]);

  const ensureVisibleRangeLoaded = useCallback(
    async (visibleMin: number, visibleMax: number) => {
      const loaded = loadedRangeRef.current;
      if (!loaded) return;

      const buffer = getViewRangeMs(viewRange) * 0.3;
      const chunkMs = getHistoryChunkMs(viewRange);

      if (
        !noMoreOlderData &&
        visibleMin < loaded.min + buffer &&
        !loadingOlderRef.current
      ) {
        loadingOlderRef.current = true;
        if (++loadingRangeCountRef.current === 1) setLoadingRange(true);
        const chunkEnd = new Date(loaded.min - 1000);
        const chunkStart = new Date(chunkEnd.getTime() - chunkMs);

        try {
          const chunk = await fetchMergedWindow(chunkStart, chunkEnd);
          if (!chunk.length) {
            setNoMoreOlderData(true);
          } else {
            setHistoryData((prev) => {
              const merged = mergeHistoryPoints(prev, chunk);
              loadedRangeRef.current = getLoadedRange(merged);
              return merged;
            });
          }
        } catch (err) {
          console.error(err);
        } finally {
          loadingOlderRef.current = false;
          if (--loadingRangeCountRef.current === 0) setLoadingRange(false);
        }
      }

      if (visibleMax > loaded.max - buffer && !loadingNewerRef.current) {
        const now = Date.now();
        if (loaded.max >= now - 60000) return;

        loadingNewerRef.current = true;
        if (++loadingRangeCountRef.current === 1) setLoadingRange(true);
        const chunkStart = new Date(loaded.max + 1000);
        const chunkEnd = new Date(Math.min(chunkStart.getTime() + chunkMs, now));

        if (chunkEnd.getTime() <= chunkStart.getTime()) {
          loadingNewerRef.current = false;
          if (--loadingRangeCountRef.current === 0) setLoadingRange(false);
          return;
        }

        try {
          const chunk = await fetchMergedWindow(chunkStart, chunkEnd);
          if (chunk.length) {
            setHistoryData((prev) => {
              const merged = mergeHistoryPoints(prev, chunk);
              loadedRangeRef.current = getLoadedRange(merged);
              return merged;
            });
          }
        } catch (err) {
          console.error(err);
        } finally {
          loadingNewerRef.current = false;
          if (--loadingRangeCountRef.current === 0) setLoadingRange(false);
        }
      }
    },
    [fetchMergedWindow, viewRange, noMoreOlderData]
  );

  const refreshLatest = useCallback(async () => {
    if (loadingNewerRef.current || loadingOlderRef.current) return;

    const loaded = loadedRangeRef.current;
    if (!loaded) return;

    const now = Date.now();
    const end = new Date(now);
    const overlapMs = 2 * 60 * 1000;
    const start = new Date(Math.max(loaded.min, loaded.max - overlapMs));

    if (end.getTime() - start.getTime() < 1000) return;

    loadingNewerRef.current = true;
    try {
      const chunk = await fetchMergedWindow(start, end);
      if (!chunk.length) return;

      setHistoryData((prev) => {
        const merged = prev.length ? mergeHistoryPoints(prev, chunk) : chunk;
        loadedRangeRef.current = getLoadedRange(merged);
        return merged;
      });
    } catch (err) {
      console.error(err);
    } finally {
      loadingNewerRef.current = false;
    }
  }, [fetchMergedWindow]);

  useEffect(() => {
    if (offlineMode || pollIntervalMs <= 0) return;
    const id = setInterval(() => {
      void refreshLatest();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs, refreshLatest, offlineMode]);

  return {
    historyData,
    historyLoading,
    loadingRange,
    historyEpoch,
    noMoreOlderData,
    resetAndLoad,
    refreshLatest,
    ensureVisibleRangeLoaded,
    hydrateFromCache,
  };
}
