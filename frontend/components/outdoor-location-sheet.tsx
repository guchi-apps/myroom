"use client";

import { useEffect, useState } from "react";
import { Search, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartColorPicker } from "@/components/chart-color-picker";
import { ChartLineVisibilityToggle } from "@/components/chart-line-visibility-toggle";
import {
  createOutdoorLocation,
  deleteOutdoorLocation,
  searchOutdoorLocations,
  setPrimaryOutdoorLocation,
  updateOutdoorLocationById,
} from "@/lib/api";
import type { OutdoorLocationEntry, OutdoorLocationSearchResult } from "@/lib/types";

/**
 * 屋外の地点を1件ぶん追加・編集するシート（#321）。
 *
 * **開いているあいだだけ描画すること。** 下書きは `useState` の初期値として
 * `location` から作るので、開くたびに `key` ごと作り直される前提になっている
 * （effect で下書きを詰め直すと React の `set-state-in-effect` に引っかかる）。
 */
interface OutdoorLocationSheetProps {
  /** 編集する地点。新しく登録するときは null（#321） */
  location: OutdoorLocationEntry | null;
  onClose: () => void;
  /** 追加・更新・削除・基準の切替のあとに呼ばれる。一覧を取り直すため */
  onChanged: () => void;
  /**
   * 推移グラフの屋外ラインの色。ラインは基準地点の1本だけなので（#321）、
   * 基準地点の設定を開いたときにだけ渡す。
   */
  chartColor?: string;
  onChartColorChange?: (color: string) => void;
  /** ダッシュボードにこの地点のカードを出すか（#321で地点ごとになった） */
  dashboardVisible?: boolean;
  onDashboardVisibleChange?: (visible: boolean) => void;
}

interface FormState {
  name: string;
  latitude: string;
  longitude: string;
}

const EMPTY_FORM: FormState = { name: "", latitude: "", longitude: "" };

export function OutdoorLocationSheet({
  location,
  onClose,
  onChanged,
  chartColor,
  onChartColorChange,
  dashboardVisible,
  onDashboardVisibleChange,
}: OutdoorLocationSheetProps) {
  const [form, setForm] = useState<FormState>(() =>
    location
      ? {
          name: location.name,
          latitude: String(location.latitude),
          longitude: String(location.longitude),
        }
      : { ...EMPTY_FORM }
  );
  const [locationSearch, setLocationSearch] = useState("");
  const [rawSearchResults, setRawSearchResults] = useState<OutdoorLocationSearchResult[]>(
    []
  );
  const [locationSearching, setLocationSearching] = useState(false);
  // 2文字未満は検索しないので、その間はレンダー時に空へ倒す（#308）
  const locationSearchResults =
    locationSearch.trim().length < 2 ? [] : rawSearchResults;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const locationId = location?.id ?? null;

  // 地名検索（デバウンス）。350ms・2文字以上は #308 から変えていない
  useEffect(() => {
    const q = locationSearch.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      setLocationSearching(true);
      try {
        setRawSearchResults(await searchOutdoorLocations(q));
      } catch {
        setRawSearchResults([]);
      } finally {
        setLocationSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [locationSearch]);

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) {
      setError("表示名を入力してください");
      return;
    }
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (form.latitude.trim() === "" || Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
      setError("緯度が正しくありません（-90〜90）");
      return;
    }
    if (
      form.longitude.trim() === "" ||
      Number.isNaN(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      setError("経度が正しくありません（-180〜180）");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (locationId) {
        await updateOutdoorLocationById(locationId, { name, latitude, longitude });
      } else {
        await createOutdoorLocation({ name, latitude, longitude });
      }
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!locationId) return;
    setSaving(true);
    setError("");
    try {
      await deleteOutdoorLocation(locationId);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async () => {
    if (!locationId) return;
    setSaving(true);
    setError("");
    try {
      await setPrimaryOutdoorLocation(locationId);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "切替に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const isPrimary = location?.is_primary ?? false;

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[85vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">
              {location ? `${location.name} の設定` : "地点を追加"}
            </h2>
            <p className="text-xs text-muted-foreground">
              Open-Meteo から取得する地点です
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

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="outdoor-location-search">地名で検索</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="outdoor-location-search"
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                placeholder="例: 大阪, 渋谷, 札幌"
                className="rounded-xl pl-9"
              />
            </div>
            {locationSearching && (
              <p className="text-xs text-muted-foreground">検索中...</p>
            )}
            {locationSearchResults.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-xl border bg-muted">
                {locationSearchResults.map((result) => (
                  <li key={`${result.latitude}-${result.longitude}-${result.label}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({
                          ...prev,
                          name: result.name,
                          latitude: String(result.latitude),
                          longitude: String(result.longitude),
                        }));
                        setLocationSearch(result.label);
                        setRawSearchResults([]);
                      }}
                      className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent"
                    >
                      <span className="font-medium">{result.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {result.latitude.toFixed(4)}, {result.longitude.toFixed(4)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="outdoor-location-name">表示名</Label>
            <Input
              id="outdoor-location-name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="例: 実家"
              className="rounded-xl"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="outdoor-location-lat">緯度</Label>
              <Input
                id="outdoor-location-lat"
                inputMode="decimal"
                value={form.latitude}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, latitude: e.target.value }))
                }
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="outdoor-location-lon">経度</Label>
              <Input
                id="outdoor-location-lon"
                inputMode="decimal"
                value={form.longitude}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, longitude: e.target.value }))
                }
                className="rounded-xl"
              />
            </div>
          </div>

          {location && dashboardVisible != null && onDashboardVisibleChange ? (
            <ChartLineVisibilityToggle
              id="outdoor-location-dashboard-visible"
              label="ダッシュボードに表示"
              description="オフにするとこの地点のカードが消えます"
              visible={dashboardVisible}
              onChange={onDashboardVisibleChange}
            />
          ) : null}

          {/* 推移グラフに出るのは基準地点の1本だけ。色の設定もそこへ置く（#321） */}
          {isPrimary && chartColor && onChartColorChange ? (
            <div className="space-y-1.5">
              <ChartColorPicker
                id="outdoor-location-chart-color"
                label="推移グラフの色"
                color={chartColor}
                onChange={onChartColorChange}
              />
              <p className="px-1 text-xs text-muted-foreground">
                推移グラフに出る屋外の線は基準地点の1本だけです
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {location && !isPrimary ? (
            <button
              type="button"
              onClick={() => void handleSetPrimary()}
              disabled={saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-medium hover:bg-accent"
            >
              <Star className="size-4" strokeWidth={1.75} />
              この地点を基準にする
            </button>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <div className="flex-1" />
            <Button
              variant="ghost"
              className="rounded-xl"
              onClick={onClose}
              disabled={saving}
            >
              キャンセル
            </Button>
            <Button
              className="rounded-xl bg-foreground text-background hover:bg-foreground/90"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? "保存中..." : "保存"}
            </Button>
          </div>

          {/*
            基準地点は消せない（推移グラフの行き先が無くなるため。バックエンドも400で弾く）。
            消したいときは先に別の地点を基準にしてもらう
          */}
          {location && !isPrimary ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={saving}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-4" strokeWidth={1.75} />
              この地点を削除
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
