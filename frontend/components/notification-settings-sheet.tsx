"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  fetchPushVapidPublicKey,
  fetchUiSettings,
  sendTestPushNotification,
  subscribePushNotifications,
  unsubscribePushNotifications,
  updateUiSettings,
} from "@/lib/api";
import {
  getExistingPushSubscription,
  getNotificationPermission,
  isPushNotificationsSupported,
  subscribeToPushNotifications,
  subscriptionToJson,
  unsubscribeFromPushNotifications,
} from "@/lib/push-notifications";
import type { UiSettings } from "@/lib/types";

interface NotificationSettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

//: 画面から一度も設定していないときに入力欄へ出す既定値。
//: 実際の既定（未設定時の挙動）は backend/garbage.py の DEFAULT_NOTIFY_HOUR = 20 と揃える
const DEFAULT_GARBAGE_NOTIFY_TIME = "20:00";

function isIosNotInstalledPwa(): boolean {
  if (typeof window === "undefined") return false;
  const isIos = /iPad|iPhone|iPod/.test(window.navigator.userAgent);
  const isStandalone =
    ("standalone" in window.navigator && Boolean((window.navigator as { standalone?: boolean }).standalone)) ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  return isIos && !isStandalone;
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-8 w-[58px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-foreground" : "bg-muted-foreground/50"
      }`}
    >
      <span
        className={`absolute top-[3px] size-[26px] rounded-full bg-white shadow transition-all ${
          checked ? "left-[29px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

export function NotificationSettingsSheet({ open, onClose }: NotificationSettingsSheetProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<UiSettings | null>(null);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported"
  );
  const [subscribed, setSubscribed] = useState(false);
  const [vapidConfigured, setVapidConfigured] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    setInfo("");
    try {
      const [uiSettings, existingSubscription] = await Promise.all([
        fetchUiSettings(),
        getExistingPushSubscription(),
      ]);
      setSettings(uiSettings);
      setSubscribed(Boolean(existingSubscription));
      setSupported(isPushNotificationsSupported());
      setPermission(getNotificationPermission());

      try {
        const { configured } = await fetchPushVapidPublicKey();
        setVapidConfigured(configured);
      } catch {
        setVapidConfigured(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const saveSettings = async (patch: Partial<UiSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    setError("");
    try {
      const saved = await updateUiSettings(patch);
      setSettings(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
      setSettings(settings);
    } finally {
      setSaving(false);
    }
  };

  const handleEnablePush = async () => {
    setSaving(true);
    setError("");
    setInfo("");
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setError("通知の許可が必要です。ブラウザまたは端末の通知設定を確認してください。");
        return;
      }

      const { publicKey } = await fetchPushVapidPublicKey();
      const subscription = await subscribeToPushNotifications(publicKey);
      await subscribePushNotifications(subscriptionToJson(subscription));
      setSubscribed(true);
      setInfo("プッシュ通知を有効にしました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "有効化に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDisablePush = async () => {
    setSaving(true);
    setError("");
    setInfo("");
    try {
      const subscription = await unsubscribeFromPushNotifications();
      if (subscription) {
        await unsubscribePushNotifications(subscription.endpoint);
      }
      setSubscribed(false);
      setInfo("この端末への配信を停止しました。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "無効化に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleTestPush = async () => {
    setSaving(true);
    setError("");
    setInfo("");
    try {
      const result = await sendTestPushNotification();
      setInfo(`テスト通知を送信しました（${result.sent}/${result.total} 件）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "テスト送信に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="通知設定"
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-[20px] bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-lg font-bold">通知設定</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full hover:bg-accent"
            aria-label="閉じる"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {loading || !settings ? (
            <p className="py-6 text-center text-sm text-muted-foreground">読み込み中...</p>
          ) : (
            <div className="space-y-5">
              {error && <p className="text-sm text-destructive">{error}</p>}
              {info && <p className="text-sm text-muted-foreground">{info}</p>}

              <section className="space-y-3 border-b pb-5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  プッシュ通知
                </p>

                {!supported ? (
                  <p className="text-[13px] text-muted-foreground">
                    このブラウザまたは環境ではプッシュ通知に対応していません。
                    {isIosNotInstalledPwa()
                      ? " iPhoneでは、ホーム画面に追加したマイルームを開いてから有効にしてください。"
                      : ""}
                  </p>
                ) : !vapidConfigured ? (
                  <p className="text-[13px] text-muted-foreground">
                    サーバー側でプッシュ通知が未設定のため、いまは有効にできません。
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold">プッシュ通知を受け取る</p>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                          {subscribed
                            ? "この端末は購読中です"
                            : "オフのままだとこの端末には配信されません"}
                          {permission === "denied"
                            ? "（OSの通知が拒否されています。端末の設定から許可してください）"
                            : ""}
                        </p>
                      </div>
                      <ToggleSwitch
                        checked={subscribed}
                        disabled={saving || permission === "denied"}
                        label="プッシュ通知を受け取る"
                        onChange={(next) => void (next ? handleEnablePush() : handleDisablePush())}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={saving || !subscribed}
                      onClick={() => void handleTestPush()}
                      className="w-full rounded-xl border bg-muted/40 px-4 py-2.5 text-[13.5px] font-bold transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      テスト通知を送信
                    </button>
                  </>
                )}
              </section>

              <section className="space-y-3 border-b pb-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold">ゴミの日を通知する</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                      収集予定日の前日、設定した時刻に1回通知します
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.garbage_notify_enabled}
                    disabled={saving}
                    label="ゴミの日を通知する"
                    onChange={(next) => void saveSettings({ garbage_notify_enabled: next })}
                  />
                </div>
                {settings.garbage_notify_enabled && (
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="garbage-notify-time" className="text-[13px]">
                      通知時刻
                    </label>
                    <input
                      id="garbage-notify-time"
                      type="time"
                      disabled={saving}
                      value={settings.garbage_notify_time ?? DEFAULT_GARBAGE_NOTIFY_TIME}
                      onChange={(event) =>
                        void saveSettings({ garbage_notify_time: event.target.value })
                      }
                      className="rounded-full bg-muted/40 px-3 py-1.5 text-[13.5px] font-bold tabular-nums"
                    />
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold">室温・湿度の異常を通知する</p>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                      閾値を超えたときと、正常に戻ったときに通知します
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.room_anomaly_notify_enabled}
                    disabled={saving}
                    label="室温・湿度の異常を通知する"
                    onChange={(next) => void saveSettings({ room_anomaly_notify_enabled: next })}
                  />
                </div>

                {settings.room_anomaly_notify_enabled && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[11px] text-muted-foreground">室温の下限（℃）</span>
                        <input
                          type="number"
                          step={0.5}
                          disabled={saving}
                          value={settings.room_anomaly_thresholds.temperature.min}
                          onChange={(event) =>
                            void saveSettings({
                              room_anomaly_thresholds: {
                                ...settings.room_anomaly_thresholds,
                                temperature: {
                                  ...settings.room_anomaly_thresholds.temperature,
                                  min: Number(event.target.value),
                                },
                              },
                            })
                          }
                          className="mt-1 w-full rounded-lg bg-muted/40 px-2.5 py-1.5 text-[13.5px] font-bold tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-muted-foreground">室温の上限（℃）</span>
                        <input
                          type="number"
                          step={0.5}
                          disabled={saving}
                          value={settings.room_anomaly_thresholds.temperature.max}
                          onChange={(event) =>
                            void saveSettings({
                              room_anomaly_thresholds: {
                                ...settings.room_anomaly_thresholds,
                                temperature: {
                                  ...settings.room_anomaly_thresholds.temperature,
                                  max: Number(event.target.value),
                                },
                              },
                            })
                          }
                          className="mt-1 w-full rounded-lg bg-muted/40 px-2.5 py-1.5 text-[13.5px] font-bold tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-muted-foreground">湿度の下限（%）</span>
                        <input
                          type="number"
                          step={1}
                          disabled={saving}
                          value={settings.room_anomaly_thresholds.humidity.min}
                          onChange={(event) =>
                            void saveSettings({
                              room_anomaly_thresholds: {
                                ...settings.room_anomaly_thresholds,
                                humidity: {
                                  ...settings.room_anomaly_thresholds.humidity,
                                  min: Number(event.target.value),
                                },
                              },
                            })
                          }
                          className="mt-1 w-full rounded-lg bg-muted/40 px-2.5 py-1.5 text-[13.5px] font-bold tabular-nums"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[11px] text-muted-foreground">湿度の上限（%）</span>
                        <input
                          type="number"
                          step={1}
                          disabled={saving}
                          value={settings.room_anomaly_thresholds.humidity.max}
                          onChange={(event) =>
                            void saveSettings({
                              room_anomaly_thresholds: {
                                ...settings.room_anomaly_thresholds,
                                humidity: {
                                  ...settings.room_anomaly_thresholds.humidity,
                                  max: Number(event.target.value),
                                },
                              },
                            })
                          }
                          className="mt-1 w-full rounded-lg bg-muted/40 px-2.5 py-1.5 text-[13.5px] font-bold tabular-nums"
                        />
                      </label>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="room-anomaly-reminder" className="text-[13px]">
                        同じ異常の再通知間隔
                      </label>
                      <div className="flex items-center gap-1.5">
                        <input
                          id="room-anomaly-reminder"
                          type="number"
                          min={5}
                          max={1440}
                          disabled={saving}
                          value={settings.room_anomaly_reminder_minutes}
                          onChange={(event) =>
                            void saveSettings({
                              room_anomaly_reminder_minutes: Number(event.target.value),
                            })
                          }
                          className="w-20 rounded-full bg-muted/40 px-3 py-1.5 text-right text-[13.5px] font-bold tabular-nums"
                        />
                        <span className="text-[13px] text-muted-foreground">分</span>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
