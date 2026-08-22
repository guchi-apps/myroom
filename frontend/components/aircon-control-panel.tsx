"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Droplets,
  Flame,
  LoaderCircle,
  Minus,
  Plus,
  Power,
  Snowflake,
  Sparkles,
  Wind,
  X,
} from "lucide-react";
import { fetchAirconControlState, sendAirconControl } from "@/lib/api";
import {
  AIRCON_CONTROL_MODES,
  AIRCON_FAN_SPEEDS,
  AIRCON_FAN_SPEED_LABELS,
  AIRCON_FAN_SWINGS,
  AIRCON_FAN_SWING_LABELS,
  AIRCON_MODE_LABELS,
  defaultAirconTargetForMode,
  formatAirconAutoTargetOffset,
  getAirconModeColor,
  isAirconPowerOff,
  resolveAirconFanSwingChoice,
  stepAirconTemperature,
  type AirconControlCommand,
  type AirconControlMode,
  type AirconControlState,
  type AirconFanSpeed,
  type AirconFanSwing,
} from "@/lib/types";

interface AirconControlPanelProps {
  acId: number;
  /** カードに出している表示名。状態が届くまでのあいだの見出しに使う */
  title: string;
  onClose: () => void;
  /** 送信が成功したら、ダッシュボードのカードも同じ状態にする */
  onApplied: (state: AirconControlState) => void;
}

/** 温度の増減をまとめて送るまでの待ち時間（ミリ秒）。連打のたびに送らないため */
const TEMPERATURE_SEND_DELAY_MS = 600;

const MODE_ICONS: Record<AirconControlMode, typeof Snowflake> = {
  COOLING: Snowflake,
  HEATING: Flame,
  DRY: Droplets,
  FAN: Wind,
  AUTO: Sparkles,
};

/** 送信した指示を、いま画面に出している状態へ先に反映する */
function applyCommand(
  state: AirconControlState,
  command: AirconControlCommand
): AirconControlState {
  return {
    ...state,
    ...(command.power !== undefined ? { power: command.power } : {}),
    ...(command.mode !== undefined ? { mode: command.mode } : {}),
    ...(command.target_temperature !== undefined
      ? { target_temperature: command.target_temperature }
      : {}),
    ...(command.fan_speed !== undefined ? { fan_speed: command.fan_speed } : {}),
    ...(command.fan_swing !== undefined ? { fan_swing: command.fan_swing } : {}),
  };
}

/**
 * エアコンの操作パネル。
 *
 * **開いている間だけマウントする。** 開くたびにエアコンの現在値を取り直したいので、
 * `open` を受け取って中で握りつぶすのではなく、親が出し入れする。
 *
 * 押した操作はすぐ画面へ出し、送信が失敗したら元へ戻す。エアコンは反映まで時間が
 * かかるので、「押したのに何も起きない」ように見えるのがいちばん困る。
 */
export function AirconControlPanel({
  acId,
  title,
  onClose,
  onApplied,
}: AirconControlPanelProps) {
  const [state, setState] = useState<AirconControlState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCommand, setRetryCommand] = useState<AirconControlCommand | null>(null);
  const temperatureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // もう一度読み込むボタンで作り直す。取得そのものは effect の中だけで行う
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchAirconControlState(acId)
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "エアコンの状態を取得できませんでした"
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [acId, reloadKey]);

  const reload = () => {
    setLoading(true);
    setLoadError(null);
    setReloadKey((key) => key + 1);
  };

  useEffect(
    () => () => {
      if (temperatureTimer.current) clearTimeout(temperatureTimer.current);
    },
    []
  );

  const send = useCallback(
    async (command: AirconControlCommand, optimistic: AirconControlState) => {
      const previous = optimistic;
      setSending(true);
      setError(null);
      setRetryCommand(null);
      try {
        const next = await sendAirconControl(acId, command);
        setState(next);
        onApplied(next);
      } catch (e) {
        // エアコンの実際の状態へ戻す。押した見た目のまま残すと、効いたと誤解される
        setState(previous);
        setError(e instanceof Error ? e.message : "エアコンを操作できませんでした");
        setRetryCommand(command);
      } finally {
        setSending(false);
      }
    },
    [acId, onApplied]
  );

  const apply = useCallback(
    (command: AirconControlCommand) => {
      if (!state || sending) return;
      const confirmed = state;
      setState(applyCommand(state, command));
      void send(command, confirmed);
    },
    [state, sending, send]
  );

  const handleTemperature = (delta: number) => {
    if (!state || sending) return;
    const isAuto = (state.mode ?? "").toUpperCase() === "AUTO";
    const base = state.target_temperature ?? (isAuto ? 0 : 26);
    const next = stepAirconTemperature(base, delta, state.mode);
    if (next === base) return;

    // 画面はすぐ動かし、送信だけまとめる（連打のたびにエアコンへ送らない）
    setState({ ...state, target_temperature: next });
    if (temperatureTimer.current) clearTimeout(temperatureTimer.current);
    temperatureTimer.current = setTimeout(() => {
      void send({ target_temperature: next }, state);
    }, TEMPERATURE_SEND_DELAY_MS);
  };

  const powerOff = isAirconPowerOff(state?.power);
  const mode = (state?.mode ?? "AUTO").toUpperCase();
  const isAuto = mode === "AUTO";
  const accent = powerOff ? "var(--muted-foreground)" : getAirconModeColor(mode);
  const target = state?.target_temperature;
  const temperatureLabel = isAuto
    ? formatAirconAutoTargetOffset(target ?? 0, { withUnit: false }) || "±0.0"
    : target != null
      ? target.toFixed(1)
      : "--";

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[88vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{state?.name || title}</h2>
            <p className="text-xs text-muted-foreground">
              {loading
                ? "状態を取得しています…"
                : loadError
                  ? "状態を取得できません"
                  : powerOff
                    ? "停止中"
                    : `運転中 ・ ${AIRCON_MODE_LABELS[mode] ?? mode}`}
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [-webkit-overflow-scrolling:touch]">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              エアコンの状態を取得しています…
            </p>
          ) : loadError || !state ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-center text-sm text-destructive">{loadError}</p>
              <button
                type="button"
                onClick={reload}
                className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground"
              >
                もう一度読み込む
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded-2xl bg-muted px-4 py-3">
                <Power
                  className="size-5 shrink-0"
                  strokeWidth={1.9}
                  style={{ color: accent }}
                />
                <div className="min-w-0">
                  <p className="text-sm font-bold">運転</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    切ると設定は保たれたまま停止します
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!powerOff}
                  aria-label="運転のオン・オフ"
                  disabled={sending}
                  onClick={() => apply({ power: powerOff ? "ON" : "OFF" })}
                  className={`relative ml-auto h-8 w-[58px] shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    powerOff ? "bg-muted-foreground/50" : ""
                  }`}
                  style={powerOff ? undefined : { backgroundColor: accent }}
                >
                  <span
                    className={`absolute top-[3px] size-[26px] rounded-full bg-white shadow transition-all ${
                      powerOff ? "left-[3px]" : "left-[29px]"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => handleTemperature(-1)}
                  disabled={sending}
                  aria-label={isAuto ? "温度シフトを下げる" : "設定温度を下げる"}
                  className="flex size-[52px] shrink-0 items-center justify-center rounded-full border bg-card disabled:opacity-40"
                >
                  <Minus className="size-5" strokeWidth={2} />
                </button>
                <div className="min-w-0 text-center">
                  <p className="text-[11px] font-bold tracking-[0.12em] text-muted-foreground">
                    {isAuto ? "温度シフト" : "設定温度"}
                  </p>
                  <p
                    className="text-[54px] font-bold leading-none tracking-tight tabular-nums"
                    style={{ color: accent }}
                  >
                    {temperatureLabel}
                    <span className="ml-0.5 text-[22px] font-medium">°C</span>
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {state.room_temperature != null
                      ? `室温 ${state.room_temperature.toFixed(1)}°C ・ `
                      : ""}
                    {isAuto ? "-5.0〜+5.0" : "16〜32"}°C で 0.5 刻み
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTemperature(1)}
                  disabled={sending}
                  aria-label={isAuto ? "温度シフトを上げる" : "設定温度を上げる"}
                  className="flex size-[52px] shrink-0 items-center justify-center rounded-full border bg-card disabled:opacity-40"
                >
                  <Plus className="size-5" strokeWidth={2} />
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-muted-foreground">運転モード</span>
                <div className="flex gap-1.5">
                  {AIRCON_CONTROL_MODES.map((option) => {
                    const Icon = MODE_ICONS[option];
                    const selected = option === mode;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={selected}
                        disabled={sending}
                        onClick={() =>
                          apply({
                            mode: option,
                            target_temperature: defaultAirconTargetForMode(
                              option,
                              state.target_temperature,
                              state.mode
                            ),
                          })
                        }
                        className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[14px] border px-1 py-2 text-xs transition-colors disabled:opacity-50"
                        style={
                          selected
                            ? {
                                color: getAirconModeColor(option),
                                borderColor: getAirconModeColor(option),
                                backgroundColor: `${getAirconModeColor(option)}1f`,
                                fontWeight: 700,
                              }
                            : undefined
                        }
                      >
                        <Icon className="size-4" strokeWidth={1.75} />
                        {AIRCON_MODE_LABELS[option]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <ChoiceRow
                label="風量"
                options={AIRCON_FAN_SPEEDS}
                labels={AIRCON_FAN_SPEED_LABELS}
                value={(state.fan_speed ?? "AUTO").toUpperCase()}
                disabled={sending}
                onSelect={(value) => apply({ fan_speed: value as AirconFanSpeed })}
              />

              <ChoiceRow
                label="風向（上下スイング）"
                options={AIRCON_FAN_SWINGS}
                labels={AIRCON_FAN_SWING_LABELS}
                value={resolveAirconFanSwingChoice(state.fan_swing)}
                disabled={sending}
                onSelect={(value) => apply({ fan_swing: value as AirconFanSwing })}
              />

              <div className="flex items-center gap-2 border-t pt-3.5 text-xs text-muted-foreground">
                {sending ? (
                  <>
                    <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
                    エアコンへ送信中… 反映まで10〜30秒ほどかかります
                  </>
                ) : error ? (
                  <>
                    <span className="min-w-0 text-destructive">{error}</span>
                    {retryCommand && (
                      <button
                        type="button"
                        onClick={() => apply(retryCommand)}
                        className="ml-auto shrink-0 rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground"
                      >
                        もう一度送る
                      </button>
                    )}
                  </>
                ) : (
                  "変更するとすぐエアコンへ送ります。反映まで10〜30秒ほどかかります"
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChoiceRow({
  label,
  options,
  labels,
  value,
  disabled,
  onSelect,
}: {
  label: string;
  options: readonly string[];
  labels: Record<string, string>;
  value: string;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold text-muted-foreground">{label}</span>
      <div className="flex gap-1.5">
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onSelect(option)}
              className={`min-w-0 flex-1 rounded-full border px-1 py-2 text-xs transition-colors disabled:opacity-50 ${
                selected
                  ? "border-primary bg-primary font-bold text-primary-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {labels[option] ?? option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
