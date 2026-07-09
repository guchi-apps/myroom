"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CloudSun,
  LayoutGrid,
  Search,
  Snowflake,
  Thermometer,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { LoginScreen } from "@/components/login-screen";
import { DeviceEditSheet } from "@/components/device-edit-sheet";
import {
  DeviceListItem,
  type DeviceListItemTrack,
} from "@/components/device-list-item";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchAirconUnits,
  fetchDevices,
  fetchOutdoorLocation,
  login,
  searchOutdoorLocations,
  updateAirconUnitName,
  updateDeviceName,
  updateOutdoorLocation,
} from "@/lib/api";
import {
  AIRCON_TARGET_COLOR_KEY,
  buildDefaultChartColors,
  CHART_COLORS_CHANGED_EVENT,
  deviceColorKey,
  getAirconTargetChartColor,
  getDeviceChartColor,
  getOutdoorChartColor,
  setChartColor,
  type ChartColorSettings,
} from "@/lib/chart-colors";
import {
  DISPLAY_ORDER_CHANGED_EVENT,
  getDisplayOrderLabel,
  normalizeDisplayOrder,
  orderItemKey,
  type DisplayOrderItem,
} from "@/lib/display-order";
import {
  AIRCON_CHART_DEVICE_ID,
  formatOutdoorApiLabel,
  getSensorDeviceIds,
  type AirconUnitInfo,
  type DeviceInfo,
  type OutdoorLocation,
  type OutdoorLocationSearchResult,
} from "@/lib/types";
import {
  findLeafDeviceId,
  getLocationName,
  isPredecessorDevice,
} from "@/lib/device-inheritance";
import {
  isTargetVisible,
  isAirconRoomVisible,
  isAirconTargetVisible,
  isDeviceDht11Visible,
  setHiddenKeyVisible,
  setTargetVisible,
  sortDisplayOrderHiddenLast,
  AIRCON_ROOM_HIDDEN_KEY,
  AIRCON_TARGET_VISIBILITY_KEY,
  VISIBLE_DEVICES_CHANGED_EVENT,
} from "@/lib/visible-devices";
import { deviceDht11VisibilityKey } from "@/lib/chart-line-visibility";
import {
  loadUiSettingsFromServer,
  saveChartColorsToServer,
  saveDisplayOrderToServer,
  saveHiddenDevicesToServer,
  savePressureOffsetsToServer,
  saveStaleAlertExcludedToServer,
} from "@/lib/ui-settings-client";

export const STALE_ALERT_EXCLUDED_CHANGED_EVENT = "stalealertexcluded_changed";
import { AuthError, clearAuthToken, isAuthenticated as hasStoredAuthToken } from "@/lib/auth";

type EditableTarget =
  | { kind: "device"; item: Extract<DisplayOrderItem, { type: "device" }> }
  | { kind: "outdoor"; item: Extract<DisplayOrderItem, { type: "outdoor" }> }
  | { kind: "aircon"; item: Extract<DisplayOrderItem, { type: "aircon" }> };

function draftKeyForItem(item: DisplayOrderItem, acId = 1): string {
  if (item.type === "device") return `device:${item.deviceId}`;
  if (item.type === "aircon") return `aircon:${acId}`;
  return "outdoor";
}

function getItemIcon(item: DisplayOrderItem): LucideIcon {
  if (item.type === "outdoor") return CloudSun;
  if (item.type === "aircon") return Snowflake;
  return Thermometer;
}

function getItemSubtitle(
  item: DisplayOrderItem,
  primaryAirconId: number,
  devices: readonly DeviceInfo[],
  deviceNames: Record<number, string>
): string {
  if (item.type === "device") {
    if (isPredecessorDevice(item.deviceId, devices)) {
      return `継承元 · デバイス ID: ${item.deviceId}（トップ画面非表示）`;
    }
    const leafId = findLeafDeviceId(item.deviceId, devices);
    const locationName = getLocationName(leafId, devices, deviceNames);
    return `場所: ${locationName} · デバイス ID: ${item.deviceId}`;
  }
  if (item.type === "aircon") {
    return `エアコン ID: ${primaryAirconId} · 色・表示は室温と設定温度で個別`;
  }
  return "Open-Meteo API";
}

function getAirconListTracks(
  hiddenKeys: Set<string>,
  chartColors: ChartColorSettings
): DeviceListItemTrack[] {
  return [
    {
      label: "室温",
      color: getDeviceChartColor(chartColors, AIRCON_CHART_DEVICE_ID),
      visible: isAirconRoomVisible(hiddenKeys),
    },
    {
      label: "設定温度",
      color: getAirconTargetChartColor(chartColors),
      visible: isAirconTargetVisible(hiddenKeys),
    },
  ];
}

export function DeviceVisibilityPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [airconUnits, setAirconUnits] = useState<AirconUnitInfo[]>([]);
  const [outdoorLocation, setOutdoorLocation] = useState<OutdoorLocation | null>(null);
  const [displayOrder, setDisplayOrder] = useState<DisplayOrderItem[]>([]);
  const [chartColors, setChartColors] = useState<ChartColorSettings>(() =>
    buildDefaultChartColors()
  );
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [staleAlertExcludedKeys, setStaleAlertExcludedKeys] = useState<Set<string>>(() => new Set());
  const [pressureOffsets, setPressureOffsets] = useState<Record<string, number>>({});
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [inheritsDrafts, setInheritsDrafts] = useState<Record<number, number | null>>({});
  const [pressureOffsetDrafts, setPressureOffsetDrafts] = useState<Record<number, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [editingTarget, setEditingTarget] = useState<EditableTarget | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [locationSearch, setLocationSearch] = useState("");
  const [locationSearchResults, setLocationSearchResults] = useState<OutdoorLocationSearchResult[]>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const [latDraft, setLatDraft] = useState("");
  const [lonDraft, setLonDraft] = useState("");

  const sensorDeviceIds = useMemo(() => getSensorDeviceIds(devices), [devices]);
  const sensorDeviceIdsKey = sensorDeviceIds.join(",");
  const primaryAirconId = airconUnits[0]?.ac_id ?? 1;

  const deviceNames = useMemo(() => {
    const names: Record<number, string> = {};
    for (const device of devices) {
      names[device.id] = device.name;
    }
    return names;
  }, [devices]);

  const airconName =
    airconUnits.find((unit) => unit.ac_id === primaryAirconId)?.name ?? "エアコン";

  const orderedTargets = useMemo(
    () => normalizeDisplayOrder(displayOrder, sensorDeviceIds),
    [displayOrder, sensorDeviceIds]
  );

  const displayedTargets = useMemo(
    () => sortDisplayOrderHiddenLast(orderedTargets, hiddenKeys),
    [orderedTargets, hiddenKeys]
  );

  const reloadSettings = useCallback(async () => {
    try {
      const settings = await loadUiSettingsFromServer(sensorDeviceIds);
      setDisplayOrder(settings.displayOrder);
      setHiddenKeys(settings.hiddenDeviceKeys);
      setChartColors(settings.chartColors);
      setStaleAlertExcludedKeys(settings.staleAlertExcludedKeys);
      setPressureOffsets(settings.pressureOffsets);
    } catch (err) {
      if (err instanceof AuthError) {
        setIsAuthenticated(false);
      }
    }
  }, [sensorDeviceIds]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [deviceList, units, outdoor] = await Promise.all([
        fetchDevices(),
        fetchAirconUnits(),
        fetchOutdoorLocation().catch(() => null),
      ]);
      setDevices(deviceList);
      setAirconUnits(units);
      setOutdoorLocation(outdoor);
    } catch {
      setDevices([]);
      setAirconUnits([]);
      setOutdoorLocation(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasStoredAuthToken()) {
      setIsAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void reloadSettings();
  }, [isAuthenticated, reloadSettings, sensorDeviceIdsKey]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadData();
  }, [isAuthenticated, loadData]);

  useEffect(() => {
    const drafts: Record<string, string> = {};
    const inheritDrafts: Record<number, number | null> = {};
    const offsetDrafts: Record<number, string> = {};
    for (const device of devices) {
      drafts[`device:${device.id}`] = device.name;
      inheritDrafts[device.id] = device.inherits_from ?? null;
      offsetDrafts[device.id] = String(pressureOffsets[String(device.id)] ?? 0);
    }
    for (const unit of airconUnits) {
      drafts[`aircon:${unit.ac_id}`] = unit.name;
    }
    if (outdoorLocation) {
      drafts.outdoor = outdoorLocation.name;
    }
    setNameDrafts(drafts);
    setInheritsDrafts(inheritDrafts);
    setPressureOffsetDrafts(offsetDrafts);
  }, [devices, airconUnits, outdoorLocation, pressureOffsets]);

  // 屋外編集シートを開いたとき、緯度・経度を初期化
  useEffect(() => {
    if (editingTarget?.kind !== "outdoor") return;
    setLocationSearch("");
    setLocationSearchResults([]);
    setLatDraft(outdoorLocation ? String(outdoorLocation.latitude) : "");
    setLonDraft(outdoorLocation ? String(outdoorLocation.longitude) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTarget?.kind]);

  // 地名検索（デバウンス）
  useEffect(() => {
    if (editingTarget?.kind !== "outdoor") return;
    const q = locationSearch.trim();
    if (q.length < 2) {
      setLocationSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLocationSearching(true);
      try {
        const results = await searchOutdoorLocations(q);
        setLocationSearchResults(results);
      } catch {
        setLocationSearchResults([]);
      } finally {
        setLocationSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [locationSearch, editingTarget?.kind]);

  const persistDisplayOrder = useCallback((order: DisplayOrderItem[]) => {
    setDisplayOrder(order);
    void saveDisplayOrderToServer(order)
      .then(() => {
        window.dispatchEvent(new Event(DISPLAY_ORDER_CHANGED_EVENT));
      })
      .catch((err) => {
        if (err instanceof AuthError) setIsAuthenticated(false);
      });
  }, []);

  const handleLogin = async (password: string) => {
    const ok = await login(password);
    if (ok) {
      setIsAuthenticated(true);
      return true;
    }
    return false;
  };

  const handleHiddenKeyVisibilityChange = (
    key: string,
    visible: boolean,
    item?: DisplayOrderItem
  ) => {
    const next = setHiddenKeyVisible(hiddenKeys, key, visible);
    setHiddenKeys(next);

    if (!visible && item && !isTargetVisible(next, item)) {
      const normalized = normalizeDisplayOrder(displayOrder, sensorDeviceIds);
      const itemKey = orderItemKey(item);
      const target = normalized.find((entry) => orderItemKey(entry) === itemKey);
      const rest = normalized.filter((entry) => orderItemKey(entry) !== itemKey);
      if (target) {
        persistDisplayOrder([...rest, target]);
      }
    }

    void saveHiddenDevicesToServer(next)
      .then(() => {
        window.dispatchEvent(new Event(VISIBLE_DEVICES_CHANGED_EVENT));
      })
      .catch((err) => {
        if (err instanceof AuthError) setIsAuthenticated(false);
      });
  };

  const handleVisibilityChange = (item: DisplayOrderItem, visible: boolean) => {
    const next = setTargetVisible(hiddenKeys, item, visible);
    setHiddenKeys(next);

    if (!visible) {
      const normalized = normalizeDisplayOrder(displayOrder, sensorDeviceIds);
      const key = orderItemKey(item);
      const target = normalized.find((entry) => orderItemKey(entry) === key);
      const rest = normalized.filter((entry) => orderItemKey(entry) !== key);
      if (target) {
        persistDisplayOrder([...rest, target]);
      }
    }

    void saveHiddenDevicesToServer(next)
      .then(() => {
        window.dispatchEvent(new Event(VISIBLE_DEVICES_CHANGED_EVENT));
      })
      .catch((err) => {
        if (err instanceof AuthError) setIsAuthenticated(false);
      });
  };

  const handleStaleAlertExcludedChange = (deviceKey: string, monitored: boolean) => {
    const next = new Set(staleAlertExcludedKeys);
    if (monitored) {
      next.delete(deviceKey);
    } else {
      next.add(deviceKey);
    }
    setStaleAlertExcludedKeys(next);
    void saveStaleAlertExcludedToServer(next)
      .then(() => {
        window.dispatchEvent(new Event(STALE_ALERT_EXCLUDED_CHANGED_EVENT));
      })
      .catch((err) => {
        if (err instanceof AuthError) setIsAuthenticated(false);
      });
  };

  const handleColorChange = (key: string, color: string) => {
    setChartColors((prev) => {
      const next = setChartColor(prev, key, color);
      void saveChartColorsToServer(next)
        .then(() => {
          window.dispatchEvent(new Event(CHART_COLORS_CHANGED_EVENT));
        })
        .catch((err) => {
          if (err instanceof AuthError) setIsAuthenticated(false);
        });
      return next;
    });
  };

  const handleDragStart = (index: number) => (event: React.DragEvent) => {
    setDragIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    const fromIndex = dragIndex ?? Number(event.dataTransfer.getData("text/plain"));
    setDragIndex(null);
    setDragOverIndex(null);
    if (!Number.isFinite(fromIndex) || fromIndex === index) return;

    const next = [...displayedTargets];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(index, 0, moved);
    persistDisplayOrder(sortDisplayOrderHiddenLast(next, hiddenKeys));
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleMove = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= displayedTargets.length) return;

    const next = [...displayedTargets];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    persistDisplayOrder(sortDisplayOrderHiddenLast(next, hiddenKeys));
  };

  const setDraft = (key: string, value: string) => {
    setNameDrafts((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const saveDeviceName = async (deviceId: number) => {
    const key = `device:${deviceId}`;
    const name = nameDrafts[key]?.trim();
    if (!name) {
      setErrors((prev) => ({ ...prev, [key]: "表示名を入力してください" }));
      return;
    }

    const offsetInput = pressureOffsetDrafts[deviceId]?.trim();
    const offsetValue = offsetInput ? Number(offsetInput) : 0;
    if (offsetInput && Number.isNaN(offsetValue)) {
      setErrors((prev) => ({ ...prev, [key]: "気圧補正値には数値を入力してください" }));
      return;
    }

    setSavingKey(key);
    setErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      // 気圧補正値の保存を先に確定させる。updateDeviceName の setDevices が
      // sensorDeviceIds の参照を変え、reloadSettings の再実行（設定の再取得）を
      // 誘発するため、後に setDevices すると再取得が古い値で上書きしてしまう。
      const nextOffsets = { ...pressureOffsets, [String(deviceId)]: offsetValue };
      setPressureOffsets(nextOffsets);
      await savePressureOffsetsToServer(nextOffsets);

      const saved = await updateDeviceName(
        deviceId,
        name,
        inheritsDrafts[deviceId] ?? null
      );
      setDevices((prev) =>
        prev.map((device) => (device.id === deviceId ? saved : device))
      );

      setEditingTarget(null);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "保存に失敗しました",
      }));
    } finally {
      setSavingKey(null);
    }
  };

  const saveAirconName = async (acId: number) => {
    const key = `aircon:${acId}`;
    const name = nameDrafts[key]?.trim();
    if (!name) {
      setErrors((prev) => ({ ...prev, [key]: "表示名を入力してください" }));
      return;
    }

    setSavingKey(key);
    setErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      const saved = await updateAirconUnitName(acId, name);
      setAirconUnits((prev) =>
        prev.map((unit) => (unit.ac_id === acId ? saved : unit))
      );
      setEditingTarget(null);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "保存に失敗しました",
      }));
    } finally {
      setSavingKey(null);
    }
  };

  const saveOutdoorName = async () => {
    const key = "outdoor";
    const name = nameDrafts[key]?.trim();
    if (!outdoorLocation) {
      setErrors((prev) => ({ ...prev, [key]: "地点データが読み込めていません" }));
      return;
    }
    if (!name) {
      setErrors((prev) => ({ ...prev, [key]: "表示名を入力してください" }));
      return;
    }

    const lat = Number(latDraft);
    const lon = Number(lonDraft);
    if (Number.isNaN(lat) || lat < -90 || lat > 90) {
      setErrors((prev) => ({ ...prev, [key]: "緯度が正しくありません（-90〜90）" }));
      return;
    }
    if (Number.isNaN(lon) || lon < -180 || lon > 180) {
      setErrors((prev) => ({ ...prev, [key]: "経度が正しくありません（-180〜180）" }));
      return;
    }

    setSavingKey(key);
    setErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      const saved = await updateOutdoorLocation({ name, latitude: lat, longitude: lon });
      setOutdoorLocation(saved);
      setEditingTarget(null);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "保存に失敗しました",
      }));
    } finally {
      setSavingKey(null);
    }
  };

  const getAccentColor = (item: DisplayOrderItem) => {
    if (item.type === "device") return getDeviceChartColor(chartColors, item.deviceId);
    if (item.type === "aircon") {
      return getDeviceChartColor(chartColors, AIRCON_CHART_DEVICE_ID);
    }
    return getOutdoorChartColor(chartColors);
  };

  const getListTitle = (item: DisplayOrderItem) => {
    if (item.type === "outdoor") {
      return formatOutdoorApiLabel(outdoorLocation?.name);
    }
    if (item.type === "device") {
      const deviceName =
        deviceNames[item.deviceId] ?? `デバイス ${item.deviceId}`;
      if (isPredecessorDevice(item.deviceId, devices)) {
        return deviceName;
      }
      return getLocationName(item.deviceId, devices, deviceNames);
    }
    return getDisplayOrderLabel(
      item,
      deviceNames,
      outdoorLocation?.name,
      airconName
    );
  };

  const buildInheritsFromOptions = (deviceId: number) => {
    const options: Array<{ value: number | null; label: string }> = [
      { value: null, label: "なし（継承しない）" },
    ];
    for (const device of devices) {
      if (device.id === deviceId || device.id === AIRCON_CHART_DEVICE_ID) continue;
      options.push({
        value: device.id,
        label: `${device.name || `デバイス ${device.id}`} (ID: ${device.id})`,
      });
    }
    return options;
  };

  const renderPressureOffsetExtra = (deviceId: number) => (
    <div className="space-y-2">
      <Label htmlFor={`device:${deviceId}-pressure-offset`}>気圧の補正値 (hPa)</Label>
      <Input
        id={`device:${deviceId}-pressure-offset`}
        inputMode="text"
        value={pressureOffsetDrafts[deviceId] ?? "0"}
        onChange={(e) =>
          setPressureOffsetDrafts((prev) => ({ ...prev, [deviceId]: e.target.value }))
        }
        placeholder="0"
        className="rounded-xl"
      />
      <p className="text-xs text-muted-foreground">
        屋外の気圧と比較して大きくずれている場合に、表示・記録される気圧値へ加算する値を設定します。
      </p>
    </div>
  );

  const renderOutdoorLocationExtra = () => (
    <>
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
                    setDraft("outdoor", result.name);
                    setLatDraft(String(result.latitude));
                    setLonDraft(String(result.longitude));
                    setLocationSearch(result.label);
                    setLocationSearchResults([]);
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="outdoor-lat">緯度</Label>
          <Input
            id="outdoor-lat"
            inputMode="decimal"
            value={latDraft}
            onChange={(e) => setLatDraft(e.target.value)}
            className="rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="outdoor-lon">経度</Label>
          <Input
            id="outdoor-lon"
            inputMode="decimal"
            value={lonDraft}
            onChange={(e) => setLonDraft(e.target.value)}
            className="rounded-xl"
          />
        </div>
      </div>
    </>
  );

  const renderEditSheet = () => {
    if (!editingTarget) return null;

    const item = editingTarget.item;
    const key = draftKeyForItem(item, primaryAirconId);
    const label = getListTitle(item);
    const Icon = getItemIcon(item);

    if (editingTarget.kind === "device") {
      const deviceId = editingTarget.item.deviceId;
      return (
        <DeviceEditSheet
          open
          onClose={() => setEditingTarget(null)}
          icon={Icon}
          accentColor={getAccentColor(item)}
          title={label}
          subtitle={getItemSubtitle(item, primaryAirconId, devices, deviceNames)}
          nameLabel="表示名"
          name={nameDrafts[key] ?? label}
          onNameChange={(value) => setDraft(key, value)}
          namePlaceholder="例: リビング"
          extraContent={renderPressureOffsetExtra(deviceId)}
          chartColors={[
            {
              id: `${key}-color`,
              label: "グラフの色",
              color: getDeviceChartColor(chartColors, deviceId),
              onChange: (color) => handleColorChange(deviceColorKey(deviceId), color),
            },
          ]}
          visibilityToggles={[
            {
              id: `${key}-dashboard-visible`,
              label: "ダッシュボードに表示",
              visible: isTargetVisible(hiddenKeys, item),
              onChange: (visible) => handleVisibilityChange(item, visible),
            },
            {
              id: `${key}-dht11-visible`,
              label: "DHT11温度を表示",
              description: "オフにするとグラフから DHT11 の温度系列を非表示にします",
              visible: isDeviceDht11Visible(hiddenKeys, deviceId),
              onChange: (visible) =>
                handleHiddenKeyVisibilityChange(
                  deviceDht11VisibilityKey(deviceId),
                  visible
                ),
            },
            {
              id: `${key}-stale-alert`,
              label: "データ未着信のアラートを通知",
              description: "オフにするとこのデバイスのデータが届かなくてもトップ画面にアラートを表示しません",
              visible: !staleAlertExcludedKeys.has(key),
              onChange: (monitored) => handleStaleAlertExcludedChange(key, monitored),
            },
          ]}
          visibilityId={`visible-${key}`}
          onSave={() => void saveDeviceName(deviceId)}
          saving={savingKey === key}
          error={errors[key]}
          inheritsFromOptions={buildInheritsFromOptions(deviceId)}
          inheritsFrom={inheritsDrafts[deviceId] ?? null}
          onInheritsFromChange={(value) =>
            setInheritsDrafts((prev) => ({ ...prev, [deviceId]: value }))
          }
        />
      );
    }

    if (editingTarget.kind === "outdoor") {
      return (
        <DeviceEditSheet
          open
          onClose={() => setEditingTarget(null)}
          icon={Icon}
          accentColor={getAccentColor(item)}
          title={formatOutdoorApiLabel(outdoorLocation?.name)}
          subtitle="地点名・座標・グラフの色を設定します"
          nameLabel="表示名"
          name={nameDrafts[key] ?? outdoorLocation?.name ?? ""}
          onNameChange={(value) => setDraft(key, value)}
          namePlaceholder="例: 茨木市"
          extraContent={renderOutdoorLocationExtra()}
          chartColors={[
            {
              id: `${key}-color`,
              label: "グラフの色",
              color: getOutdoorChartColor(chartColors),
              onChange: (color) => handleColorChange("outdoor", color),
            },
          ]}
          visible={isTargetVisible(hiddenKeys, item)}
          onVisibleChange={(visible) => handleVisibilityChange(item, visible)}
          visibilityId={`visible-${key}`}
          onSave={() => void saveOutdoorName()}
          saving={savingKey === key}
          saveDisabled={!outdoorLocation}
          error={errors[key]}
        />
      );
    }

    return (
      <DeviceEditSheet
        open
        onClose={() => setEditingTarget(null)}
        icon={Icon}
        accentColor={getAccentColor(item)}
        title={label}
        subtitle={getItemSubtitle(item, primaryAirconId, devices, deviceNames)}
        nameLabel="表示名"
        name={nameDrafts[key] ?? label}
        onNameChange={(value) => setDraft(key, value)}
        namePlaceholder="例: リビング"
        chartColors={[
          {
            id: `${key}-room-color`,
            label: "グラフの色（室温）",
            color: getDeviceChartColor(chartColors, AIRCON_CHART_DEVICE_ID),
            onChange: (color) =>
              handleColorChange(deviceColorKey(AIRCON_CHART_DEVICE_ID), color),
          },
          {
            id: `${key}-target-color`,
            label: "グラフの色（設定温度）",
            color: getAirconTargetChartColor(chartColors),
            onChange: (color) => handleColorChange(AIRCON_TARGET_COLOR_KEY, color),
          },
        ]}
        visible={isTargetVisible(hiddenKeys, item)}
        onVisibleChange={(visible) => handleVisibilityChange(item, visible)}
        visibilityToggles={[
          {
            id: `${key}-room-visible`,
            label: "ダッシュボードに表示（室温）",
            visible: isAirconRoomVisible(hiddenKeys),
            onChange: (visible) =>
              handleHiddenKeyVisibilityChange(AIRCON_ROOM_HIDDEN_KEY, visible, item),
          },
          {
            id: `${key}-target-visible`,
            label: "ダッシュボードに表示（設定温度）",
            visible: isAirconTargetVisible(hiddenKeys),
            onChange: (visible) =>
              handleHiddenKeyVisibilityChange(AIRCON_TARGET_VISIBILITY_KEY, visible, item),
          },
        ]}
        visibilityId={`visible-${key}`}
        onSave={() => void saveAirconName(primaryAirconId)}
        saving={savingKey === key}
        error={errors[key]}
      />
    );
  };

  if (!isAuthenticated) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="pb-10">
      <div className="space-y-6 px-5 pt-12">
        <header className="flex items-center gap-3">
          <Link
            href="/"
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="ダッシュボードへ戻る"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <LayoutGrid className="size-5 text-muted-foreground" />
              <h1 className="text-lg font-bold">デバイス</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              表示名・色・表示順・ダッシュボードへの表示を管理します
            </p>
          </div>
        </header>

        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">読み込み中...</p>
        ) : (
          <section className="space-y-3">
            <p className="px-0.5 text-xs text-muted-foreground">
              <span className="sm:hidden">矢印ボタンで順番を変更できます</span>
              <span className="hidden sm:inline">左のグリップをドラッグして順番を変更できます</span>
            </p>
            {displayedTargets.length > 0 ? (
              displayedTargets.map((item, index) => {
                const key = draftKeyForItem(item, primaryAirconId);
                return (
                  <DeviceListItem
                    key={key}
                    icon={getItemIcon(item)}
                    accentColor={getAccentColor(item)}
                    title={getListTitle(item)}
                    subtitle={getItemSubtitle(item, primaryAirconId, devices, deviceNames)}
                    visible={isTargetVisible(hiddenKeys, item)}
                    tracks={
                      item.type === "aircon"
                        ? getAirconListTracks(hiddenKeys, chartColors)
                        : undefined
                    }
                    onEdit={() => {
                      if (item.type === "device") {
                        setEditingTarget({ kind: "device", item });
                      } else if (item.type === "outdoor") {
                        setEditingTarget({ kind: "outdoor", item });
                      } else {
                        setEditingTarget({ kind: "aircon", item });
                      }
                    }}
                    onDragStart={handleDragStart(index)}
                    onDragOver={handleDragOver(index)}
                    onDrop={handleDrop(index)}
                    onDragEnd={handleDragEnd}
                    isDragOver={dragOverIndex === index && dragIndex !== index}
                    onMoveUp={() => handleMove(index, -1)}
                    onMoveDown={() => handleMove(index, 1)}
                    canMoveUp={index > 0}
                    canMoveDown={index < displayedTargets.length - 1}
                  />
                );
              })
            ) : (
              <p className="rounded-[18px] border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                登録済みのデバイスがありません
              </p>
            )}
          </section>
        )}
      </div>

      {renderEditSheet()}
    </div>
  );
}
