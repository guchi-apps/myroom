"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Search, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChartColorPicker } from "@/components/chart-color-picker";
import { ChartLineVisibilityToggle } from "@/components/chart-line-visibility-toggle";
import { cn } from "@/lib/utils";
import {
  createOutdoorLocation,
  deleteOutdoorLocation,
  fetchOutdoorLocations,
  searchOutdoorLocations,
  setPrimaryOutdoorLocation,
  updateOutdoorLocationById,
} from "@/lib/api";
import type { OutdoorLocationEntry, OutdoorLocationSearchResult } from "@/lib/types";

interface OutdoorLocationsSheetProps {
  open: boolean;
  onClose: () => void;
  /** 一覧・基準地点が変わったときに呼ばれる（呼び出し元の基準地点表示を更新するため） */
  onChanged: () => void;
  chartColor: string;
  onChartColorChange: (color: string) => void;
  dashboardVisible: boolean;
  onDashboardVisibleChange: (visible: boolean) => void;
}

interface FormState {
  /** 既存地点の編集なら地点ID。新規登録なら null */
  id: string | null;
  name: string;
  latitude: string;
  longitude: string;
}

const EMPTY_FORM: FormState = { id: null, name: "", latitude: "", longitude: "" };

export function OutdoorLocationsSheet({
  open,
  onClose,
  onChanged,
  chartColor,
  onChartColorChange,
  dashboardVisible,
  onDashboardVisibleChange,
}: OutdoorLocationsSheetProps) {
  const [locations, setLocations] = useState<OutdoorLocationEntry[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
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

  const reload = async () => {
    try {
      setLocations(await fetchOutdoorLocations());
    } catch {
      setLocations([]);
    }
  };

  useEffect(() => {
    if (!open) return;
    setForm(null);
    setError("");
    void reload();
  }, [open]);

  // 地名検索（デバウンス）。device-visibility-page.tsx の屋外編集と同じ間隔・文字数
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

  if (!open) return null;

  const startCreate = () => {
    setForm({ ...EMPTY_FORM });
    setLocationSearch("");
    setRawSearchResults([]);
    setError("");
  };

  const startEdit = (loc: OutdoorLocationEntry) => {
    setForm({
      id: loc.id,
      name: loc.name,
      latitude: String(loc.latitude),
      longitude: String(loc.longitude),
    });
    setLocationSearch("");
    setRawSearchResults([]);
    setError("");
  };

  const handleSave = async () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setError("表示名を入力してください");
      return;
    }
    const latitude = Number(form.latitude);
    const longitude = Number(form.longitude);
    if (Number.isNaN(latitude) || latitude < -90 || latitude > 90) {
      setError("緯度が正しくありません（-90〜90）");
      return;
    }
    if (Number.isNaN(longitude) || longitude < -180 || longitude > 180) {
      setError("経度が正しくありません（-180〜180）");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (form.id) {
        await updateOutdoorLocationById(form.id, { name, latitude, longitude });
      } else {
        await createOutdoorLocation({ name, latitude, longitude });
      }
      setForm(null);
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    setError("");
    try {
      await deleteOutdoorLocation(id);
      setForm(null);
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async (id: string) => {
    setSaving(true);
    setError("");
    try {
      await setPrimaryOutdoorLocation(id);
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "切替に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const editingExisting = form?.id
    ? locations?.find((loc) => loc.id === form.id) ?? null
    : null;

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[85vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">地点の設定</h2>
            <p className="text-xs text-muted-foreground">複数の地点を登録できます</p>
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

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          <ChartColorPicker
            id="outdoor-locations-chart-color"
            label="グラフの色"
            color={chartColor}
            onChange={onChartColorChange}
          />
          <ChartLineVisibilityToggle
            id="outdoor-locations-dashboard-visible"
            label="ダッシュボードに表示"
            description="オフにするとカード・グラフ・日次記録から非表示になります"
            visible={dashboardVisible}
            onChange={onDashboardVisibleChange}
          />
          <div className="pt-1 text-xs font-semibold text-muted-foreground">地点一覧</div>

          {locations == null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">読み込み中...</p>
          ) : (
            locations.map((loc) => (
              <div
                key={loc.id}
                className="flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2.5"
              >
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    loc.is_primary
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {loc.is_primary ? "基準" : "–"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{loc.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(loc)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border hover:bg-accent"
                  aria-label={`${loc.name}を編集`}
                >
                  <Pencil className="size-4" strokeWidth={1.75} />
                </button>
              </div>
            ))
          )}

          {form ? (
            <div className="space-y-3 rounded-xl border bg-background/60 p-3">
              <p className="text-sm font-semibold">
                {form.id ? `${editingExisting?.name ?? ""} を編集` : "地点を追加"}
              </p>

              <div className="space-y-2">
                <Label htmlFor="outdoor-locations-search">地名で検索</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="outdoor-locations-search"
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
                            setForm((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    name: result.name,
                                    latitude: String(result.latitude),
                                    longitude: String(result.longitude),
                                  }
                                : prev
                            );
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
                <Label htmlFor="outdoor-locations-name">表示名</Label>
                <Input
                  id="outdoor-locations-name"
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                  }
                  placeholder="例: 実家"
                  className="rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="outdoor-locations-lat">緯度</Label>
                  <Input
                    id="outdoor-locations-lat"
                    inputMode="decimal"
                    value={form.latitude}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev ? { ...prev, latitude: e.target.value } : prev
                      )
                    }
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="outdoor-locations-lon">経度</Label>
                  <Input
                    id="outdoor-locations-lon"
                    inputMode="decimal"
                    value={form.longitude}
                    onChange={(e) =>
                      setForm((prev) =>
                        prev ? { ...prev, longitude: e.target.value } : prev
                      )
                    }
                    className="rounded-xl"
                  />
                </div>
              </div>

              {error ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              {form.id && editingExisting && !editingExisting.is_primary ? (
                <button
                  type="button"
                  onClick={() => void handleSetPrimary(form.id!)}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-medium hover:bg-accent"
                >
                  <Star className="size-4" strokeWidth={1.75} />
                  この地点をダッシュボードの基準にする
                </button>
              ) : null}

              <div className="flex items-center gap-2 pt-1">
                {form.id && editingExisting && !editingExisting.is_primary ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete(form.id!)}
                    disabled={saving}
                    className="text-sm font-medium text-destructive underline"
                  >
                    削除
                  </button>
                ) : null}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  className="rounded-xl"
                  onClick={() => setForm(null)}
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
            </div>
          ) : (
            <button
              type="button"
              onClick={startCreate}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-3 text-sm font-semibold text-foreground hover:bg-accent"
            >
              <Plus className="size-4" strokeWidth={1.75} />
              地点を追加
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
