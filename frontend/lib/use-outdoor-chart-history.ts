"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getViewRangeMs } from "@/lib/chart-utils";
import { fetchOutdoorHistoryWindow } from "@/lib/api";
import {
  getHistoryChunkMs,
  getHistoryInitialSpanMs,
  getHistoryQuickInitialSpanMs,
  getLoadedRange,
  mergeHistoryPoints,
} from "@/lib/history-loader";
import type { ChartViewRange, HistoryPoint } from "@/lib/types";

export interface UseOutdoorChartHistoryOptions {
  /** グラフ履歴の自動更新間隔（ms）。0 で無効。既定 30 秒 */
  pollIntervalMs?: number;
  offlineHistory?: HistoryPoint[] | null;
  offlineCacheKey?: string | null;
  offlineMode?: boolean;
}

function filterOutdoorHistory(points: HistoryPoint[]): HistoryPoint[] {
  return points.filter(
    (point) =>
      point.outdoor_temperature != null ||
      point.outdoor_humidity != null ||
      point.outdoor_pressure != null
  );
}

export function useOutdoorChartHistory(
  viewRange: ChartViewRange,
  options?: UseOutdoorChartHistoryOptions
) {
  const pollIntervalMs = options?.pollIntervalMs ?? 30000;
  const offlineHistory = options?.offlineHistory ?? null;
  const offlineCacheKey = options?.offlineCacheKey ?? null;
  const offlineMode = options?.offlineMode ?? false;
  const offlineHistoryRef = useRef<HistoryPoint[] | null>(null);
  offlineHistoryRef.current = offlineHistory;

  const [historyData, setHistoryData] = useState<HistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  /** 最新データの取得が終わるまで true。true の間はグラフを描かない */
  const [awaitingLatest, setAwaitingLatest] = useState(true);
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

  const fetchWindow = useCallback(
    async (start: Date, end: Date) => fetchOutdoorHistoryWindow(start, end, viewRange),
    [viewRange]
  );

  const resetAndLoad = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!historyDataRef.current.length) {
      setHistoryLoading(true);
    }
    setAwaitingLatest(true);
    setNoMoreOlderData(false);
    loadedRangeRef.current = null;

    const end = new Date();
    const fullSpanMs = getHistoryInitialSpanMs(viewRange);
    const quickSpanMs = Math.min(getHistoryQuickInitialSpanMs(viewRange), fullSpanMs);
    const quickStart = new Date(end.getTime() - quickSpanMs);

    try {
      const quickChunk = await fetchWindow(quickStart, end);
      if (generation !== loadGenerationRef.current) return;

      setHistoryData(quickChunk);
      loadedRangeRef.current = getLoadedRange(quickChunk);
      setHistoryEpoch((epoch) => epoch + 1);
      setHistoryLoading(false);
      setAwaitingLatest(false);

      if (fullSpanMs > quickSpanMs) {
        const fullStart = new Date(end.getTime() - fullSpanMs);
        const olderChunk = await fetchWindow(fullStart, quickStart);
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
      setAwaitingLatest(false);
    }
  }, [fetchWindow, viewRange]);

  const hydrateFromCache = useCallback((points: HistoryPoint[]) => {
    const outdoorOnly = filterOutdoorHistory(points);
    setHistoryLoading(false);
    setAwaitingLatest(false);
    setNoMoreOlderData(true);
    setHistoryData(outdoorOnly);
    loadedRangeRef.current = outdoorOnly.length ? getLoadedRange(outdoorOnly) : null;
    setHistoryEpoch((epoch) => epoch + 1);
  }, []);

  useEffect(() => {
    if (offlineMode) {
      // オフラインでは最新データを取得できないため、キャッシュをそのまま見せる
      if (offlineHistoryRef.current?.length) {
        hydrateFromCache(offlineHistoryRef.current);
      } else {
        setAwaitingLatest(false);
      }
      return;
    }

    let cancelled = false;

    async function init() {
      if (!cancelled) {
        await resetAndLoad();
      }
    }

    void init();
    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
    };
  }, [resetAndLoad, viewRange, offlineMode, offlineCacheKey, hydrateFromCache]);

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
          const chunk = await fetchWindow(chunkStart, chunkEnd);
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
          const chunk = await fetchWindow(chunkStart, chunkEnd);
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
    [fetchWindow, viewRange, noMoreOlderData]
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
      const chunk = await fetchWindow(start, end);
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
  }, [fetchWindow]);

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
    awaitingLatest,
    loadingRange,
    historyEpoch,
    noMoreOlderData,
    resetAndLoad,
    refreshLatest,
    ensureVisibleRangeLoaded,
    hydrateFromCache,
  };
}
