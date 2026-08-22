"use client";

import { Zap } from "lucide-react";
import {
  buildEnergyComparison,
  buildEnergySourceColors,
  energySourceRatio,
  formatEnergyDate,
  formatKwh,
  formatWatts,
  formatYen,
  hasEnergyData,
  isEnergyStale,
} from "@/lib/energy";
import type { EnergyBreakdown, EnergySourceRow } from "@/lib/types";
import { cn } from "@/lib/utils";

interface PowerCardProps {
  breakdown: EnergyBreakdown | null;
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
        消費電力
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

/**
 * 取得元1件ぶんの行。
 *
 * 主役は使用量（kWh）で、金額は単価を掛けた目安なので添え物として小さく置く。
 * いまの W はスマートプラグしか返さないため、エアコンでは「—」になる。
 */
function SourceRow({
  row,
  color,
  ratio,
}: {
  row: EnergySourceRow;
  color: string;
  ratio: number;
}) {
  const missing = row.today_kwh == null;
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-[13px] tabular-nums",
        missing && "opacity-55"
      )}
    >
      <span
        className="size-2 shrink-0 rounded-[3px]"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="w-16 shrink-0 truncate font-bold">{row.label}</span>
      <span className="w-[52px] shrink-0 text-right">
        {row.today_kwh == null ? "—" : row.today_kwh.toFixed(2)}
      </span>
      <span className="w-12 shrink-0 text-right text-[12px] text-muted-foreground">
        {formatYen(row.today_cost_yen)}
      </span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${ratio * 100}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-11 shrink-0 text-right text-[11px] text-muted-foreground">
        {formatWatts(row.power_w)}
      </span>
    </div>
  );
}

/**
 * 「暮らし」セクションの消費電力カード。
 *
 * エアコン（AirCloud Home）とスマートプラグ（Tapo）を1枚にまとめる。知りたいのは
 * 「家全体で今月いくらか」で、取得元ごとにカードを分けると足し算が読み手の仕事になる。
 * タップで詳細が開く。
 */
export function PowerCard({
  breakdown,
  loading,
  error,
  onOpenDetail,
}: PowerCardProps) {
  if (loading && !breakdown) {
    return (
      <CardShell>
        <div className="flex flex-col gap-2.5">
          <div className="h-[52px] animate-pulse rounded-2xl bg-muted" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
        </div>
      </CardShell>
    );
  }

  if (error && !breakdown) {
    return (
      <CardShell>
        <p className="text-sm text-destructive">消費電力を読み込めませんでした</p>
      </CardShell>
    );
  }

  if (!hasEnergyData(breakdown)) {
    return (
      <CardShell>
        <p className="text-sm text-muted-foreground">
          まだ使用量を受け取っていません。エアコンとスマートプラグからの送信が始まると、ここに取得元ごとの使用量が並びます。
        </p>
      </CardShell>
    );
  }

  const data = breakdown as EnergyBreakdown;
  const colors = buildEnergySourceColors(data.sources);
  const comparison = buildEnergyComparison(data);
  // `this_month.end` はサーバーが JST で決めた「今日」。端末の時計に寄せない
  const stale = isEnergyStale(data, data.this_month.end);

  return (
    <CardShell onClick={onOpenDetail} unitPrice={data.unit_price}>
      <div
        className="flex items-baseline gap-2.5 rounded-2xl px-3.5 py-2.5"
        style={{ backgroundColor: "var(--energy-surface)" }}
      >
        <span className="text-[12px] text-muted-foreground">今日</span>
        <span className="text-[27px] font-bold leading-none tracking-tight tabular-nums">
          {data.today.kwh.toFixed(2)}
        </span>
        <span className="text-[13px] font-bold text-muted-foreground">kWh</span>
        <span className="ml-auto text-sm font-bold text-muted-foreground tabular-nums">
          {formatYen(data.today.cost_yen)}
        </span>
      </div>

      {stale ? (
        <p className="text-xs" style={{ color: "var(--energy-color)" }}>
          {formatEnergyDate(data.latest_date ?? "")} 以降のデータが届いていません
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.sources.map((row) => (
            <SourceRow
              key={row.source}
              row={row}
              color={colors[row.source] ?? "#95a5a6"}
              ratio={energySourceRatio(data.sources, row)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-2.5 text-[12px] text-muted-foreground tabular-nums">
        <span>
          今月{" "}
          <b className="text-[13px] font-bold text-foreground">
            {formatKwh(data.this_month.kwh)}
          </b>{" "}
          ・{" "}
          <b className="text-[13px] font-bold text-foreground">
            {formatYen(data.this_month.cost_yen)}
          </b>
        </span>
        {comparison && (
          <span>
            先月同日{" "}
            <b
              className={cn(
                "font-bold",
                comparison.cheaper
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-orange-600 dark:text-orange-400"
              )}
            >
              {comparison.percent}% {comparison.cheaper ? "少ない" : "多い"}
            </b>
          </span>
        )}
      </div>
    </CardShell>
  );
}
