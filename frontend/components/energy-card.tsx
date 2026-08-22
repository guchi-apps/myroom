"use client";

import { Zap } from "lucide-react";
import {
  buildEnergyComparison,
  buildEnergySparkline,
  ENERGY_SPARKLINE_DAYS,
  formatEnergyDate,
  formatKwh,
  formatYen,
  hasEnergyData,
  isEnergyStale,
} from "@/lib/energy";
import type { EnergyDay, EnergySummary } from "@/lib/types";
import { cn } from "@/lib/utils";

interface EnergyCardProps {
  summary: EnergySummary | null;
  loading: boolean;
  error: boolean;
  onOpenDetail: () => void;
}

function CardShell({
  children,
  onClick,
  unitPrice,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  unitPrice?: number | null;
}) {
  const head = (
    <div className="flex items-start justify-between gap-2">
      <p className="device-card-title flex min-w-0 items-center gap-2">
        <Zap
          className="size-5 shrink-0"
          strokeWidth={1.9}
          style={{ color: "var(--energy-color)" }}
        />
        エアコンの電気代
      </p>
      {unitPrice != null && (
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-[11px] text-muted-foreground tabular-nums">
          {unitPrice} 円/kWh
        </span>
      )}
    </div>
  );

  if (!onClick) {
    return (
      <div className="device-card gap-3">
        {head}
        {children}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="device-card gap-3 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {head}
      {children}
    </button>
  );
}

function DayRow({ label, day, maxKwh }: { label: string; day: EnergyDay | null; maxKwh: number }) {
  const ratio = maxKwh > 0 ? (day?.kwh ?? 0) / maxKwh : 0;
  return (
    <div className="flex items-baseline gap-2.5 text-[13px] tabular-nums">
      <span className="w-8 shrink-0 text-muted-foreground">{label}</span>
      <span className="w-[68px] shrink-0 text-right">{formatKwh(day?.kwh)}</span>
      <span className="w-14 shrink-0 text-right text-muted-foreground">
        {formatYen(day?.cost_yen)}
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(1, ratio)) * 100}%`,
            backgroundColor: "var(--energy-color)",
          }}
        />
      </span>
    </div>
  );
}

/**
 * 「暮らし」セクションの電気代カード。
 * 使用量（kWh）は取得元から、金額は単価を掛けた目安。タップで詳細が開く。
 */
export function EnergyCard({
  summary,
  loading,
  error,
  onOpenDetail,
}: EnergyCardProps) {
  if (loading && !summary) {
    return (
      <CardShell>
        <div className="flex flex-col gap-2.5">
          <div className="h-[68px] animate-pulse rounded-2xl bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
        </div>
      </CardShell>
    );
  }

  if (error && !summary) {
    return (
      <CardShell>
        <p className="text-sm text-destructive">電気代を読み込めませんでした</p>
      </CardShell>
    );
  }

  if (!hasEnergyData(summary)) {
    return (
      <CardShell>
        <p className="text-sm text-muted-foreground">
          まだ使用量を受け取っていません。Raspberry Pi の収集スクリプトが動き出すと表示されます。
        </p>
      </CardShell>
    );
  }

  const data = summary as EnergySummary;
  const comparison = buildEnergyComparison(data);
  const bars = buildEnergySparkline(data.daily);
  // `this_month.end` はサーバーが JST で決めた「今日」。端末の時計に寄せない
  const stale = isEnergyStale(data, data.this_month.end);
  const dayMax = Math.max(data.today?.kwh ?? 0, data.yesterday?.kwh ?? 0);

  return (
    <CardShell onClick={onOpenDetail} unitPrice={data.unit_price}>
      <div
        className="flex items-end gap-3 rounded-2xl px-3.5 py-3"
        style={{ backgroundColor: "var(--energy-surface)" }}
      >
        <div className="min-w-0">
          <span className="block text-[11px] tracking-wider text-muted-foreground">
            今月の目安（{formatEnergyDate(data.this_month.start)}〜
            {formatEnergyDate(data.this_month.end)}）
          </span>
          <span className="text-[30px] font-bold leading-none tracking-tight tabular-nums">
            {formatYen(data.this_month.cost_yen)}
          </span>
        </div>
        <div className="ml-auto shrink-0 text-right">
          <div className="text-[15px] font-bold tabular-nums">
            {formatKwh(data.this_month.kwh)}
          </div>
          <div className="text-[11px] text-muted-foreground">今月の使用量</div>
        </div>
      </div>

      {stale ? (
        <p className="text-xs" style={{ color: "var(--energy-color)" }}>
          {formatEnergyDate(data.latest_date ?? "")} 以降のデータが届いていません
        </p>
      ) : (
        comparison && (
          <p className="text-xs text-muted-foreground tabular-nums">
            先月の同じ時期は {formatYen(comparison.baseCostYen)} ／{" "}
            <b
              className={cn(
                "font-bold",
                comparison.cheaper ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"
              )}
            >
              {comparison.percent}% {comparison.cheaper ? "少ない" : "多い"}
            </b>
          </p>
        )
      )}

      <div className="flex flex-col gap-1.5">
        <DayRow label="今日" day={data.today} maxKwh={dayMax} />
        <DayRow label="昨日" day={data.yesterday} maxKwh={dayMax} />
      </div>

      {bars.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex h-[46px] items-end gap-[3px]">
            {bars.map((bar) => (
              <span
                key={bar.date}
                className="min-h-[2px] flex-1 rounded-t-[2px]"
                style={{
                  height: `${Math.max(4, bar.ratio * 100)}%`,
                  backgroundColor: "var(--energy-color)",
                  opacity: bar.isLast ? 1 : 0.75,
                }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10.5px] text-muted-foreground tabular-nums">
            <span>{formatEnergyDate(bars[0].date)}</span>
            <span>直近{ENERGY_SPARKLINE_DAYS}日</span>
            <span>{formatEnergyDate(bars[bars.length - 1].date)}</span>
          </div>
        </div>
      )}
    </CardShell>
  );
}
