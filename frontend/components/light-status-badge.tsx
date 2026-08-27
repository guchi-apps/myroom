"use client";

import { Lightbulb } from "lucide-react";
import {
  formatLightStatusDetail,
  LIGHT_STATUS_HEADLINES,
  LIGHT_STATUS_LABELS,
  type LightStatusResult,
} from "@/lib/light-status";

/**
 * 照度から判定した照明の状態（#258）。
 *
 * カードにはバッジ、詳細パネルには判定の根拠まで含む1行を出す。色は「電気の操作」カードと
 * 同じ `--remote-color` にして、消費電力のアンバー（`--energy-color`）と混ざらないようにする。
 */

const LIT_COLOR = "var(--remote-color)";
const LIT_SURFACE = "color-mix(in srgb, var(--remote-color) 18%, transparent)";

interface LightStatusBadgeProps {
  result: LightStatusResult;
}

/** カードの計測値の下に置くバッジ。エアコンの運転状態バッジと同じ形にそろえる */
export function LightStatusBadge({ result }: LightStatusBadgeProps) {
  const isOn = result.status === "on";
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${
        isOn ? "" : "bg-muted text-muted-foreground"
      }`}
      style={isOn ? { color: LIT_COLOR, backgroundColor: LIT_SURFACE } : undefined}
      title={formatLightStatusDetail(result)}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      照明 {LIGHT_STATUS_LABELS[result.status]}
    </span>
  );
}

/**
 * 詳細パネルの「いまの値」の下に置く1行。
 * 判定の結論だけでなく、いまの照度としきい値も出してしきい値のずれに気づけるようにする。
 */
export function LightStatusStrip({ result }: LightStatusBadgeProps) {
  const isOn = result.status === "on";
  return (
    <section className="px-5 pt-2.5">
      <div
        className={`flex items-center gap-2.5 rounded-[14px] px-3.5 py-2.5 ${
          isOn ? "" : "bg-muted"
        }`}
        style={isOn ? { backgroundColor: LIT_SURFACE } : undefined}
      >
        <Lightbulb
          className={`size-5 shrink-0 ${isOn ? "" : "text-muted-foreground"}`}
          strokeWidth={1.75}
          style={isOn ? { color: LIT_COLOR } : undefined}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-sm font-bold">{LIGHT_STATUS_HEADLINES[result.status]}</p>
          <p className="text-[11.5px] tabular-nums text-muted-foreground">
            {formatLightStatusDetail(result)}
          </p>
        </div>
      </div>
    </section>
  );
}
