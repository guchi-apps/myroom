"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { updateUiSettings } from "@/lib/api";
import {
  buildEnergyDailyRows,
  buildEnergySourceColors,
  buildEnergyStackColumns,
  buildEnergyStackSegments,
  formatEnergyDate,
  formatEnergyDateWithWeekday,
  formatKwh,
  formatYen,
} from "@/lib/energy";
import type { EnergyBreakdown, EnergyTotal } from "@/lib/types";

interface PowerDetailPanelProps {
  open: boolean;
  breakdown: EnergyBreakdown | null;
  onClose: () => void;
  /** 単価を保存したあと。集計をやり直すために親へ知らせる */
  onUnitPriceSaved: (unitPrice: number) => void;
}

function Tile({ caption, total }: { caption: string; total: EnergyTotal }) {
  return (
    <div className="rounded-2xl bg-muted px-3 py-2.5">
      <div className="text-[11px] leading-tight text-muted-foreground">
        {caption}
        <br />
        <span className="text-[10px]">
          {formatEnergyDate(total.start)}〜{formatEnergyDate(total.end)}
        </span>
      </div>
      <div className="mt-0.5 text-[18px] font-bold leading-tight tracking-tight tabular-nums">
        {formatYen(total.cost_yen)}
      </div>
      <div className="text-[11.5px] text-muted-foreground tabular-nums">
        {formatKwh(total.kwh)}
      </div>
    </div>
  );
}

/**
 * 消費電力カードの詳細。
 *
 * 日別は取得元ごとの積み上げにする。合計だけだと「今月増えた」までしか分からず、
 * 増えたのがエアコンなのかどのプラグなのかが読めないため。
 */
export function PowerDetailPanel({
  open,
  breakdown,
  onClose,
  onUnitPriceSaved,
}: PowerDetailPanelProps) {
  // 親が `open` のときだけマウントするため、初期値をここで決めれば開くたびに入れ直される
  const [priceInput, setPriceInput] = useState(() =>
    breakdown ? String(breakdown.unit_price) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const sources = breakdown?.sources ?? [];
  const colors = buildEnergySourceColors(sources);
  const columns = buildEnergyStackColumns(breakdown);
  const rows = buildEnergyDailyRows(breakdown?.daily ?? []);

  const plugCount = sources.filter((row) => row.source.startsWith("tapo:")).length;
  const hasAircon = sources.some((row) => row.source === "aircon");
  const subtitle = [
    hasAircon ? "エアコン" : null,
    plugCount > 0 ? `Tapo スマートプラグ ${plugCount} 台` : null,
  ]
    .filter(Boolean)
    .join(" ・ ");

  const handleSave = async () => {
    const price = Number(priceInput);
    if (!Number.isFinite(price) || price <= 0) {
      setError("単価は0より大きい数値で入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const settings = await updateUiSettings({ energy_unit_price: price });
      onUnitPriceSaved(settings.energy_unit_price);
    } catch {
      setError("単価を保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[88vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">消費電力</h2>
            <p className="text-xs text-muted-foreground">
              {subtitle || "取得元なし"}
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
          <div className="flex flex-col gap-4">
            {breakdown && (
              <div className="grid grid-cols-3 gap-2">
                <Tile
                  caption="今月"
                  total={breakdown.this_month}
                />
                <Tile caption="先月同日まで" total={breakdown.last_month_to_date} />
                <Tile caption="先月" total={breakdown.last_month} />
              </div>
            )}

            {columns.length > 1 && (
              <div className="flex flex-col gap-2">
                <div className="flex h-[110px] items-end gap-[3px]">
                  {columns.map((column) => (
                    <div
                      key={column.date}
                      className="flex min-w-0 flex-1 flex-col justify-end gap-[1.5px]"
                      style={{ height: `${Math.max(4, column.ratio * 100)}%` }}
                      title={`${formatEnergyDate(column.date)} ${formatKwh(column.kwh)}`}
                    >
                      {column.segments.map((segment) => (
                        <span
                          key={segment.source}
                          className="block min-h-px rounded-[1.5px]"
                          style={{
                            height: `${segment.share * 100}%`,
                            backgroundColor: segment.color,
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="flex justify-between border-t pt-1.5 text-[10.5px] text-muted-foreground tabular-nums">
                  <span>{formatEnergyDate(columns[0].date)}</span>
                  <span>日別（記録のある日だけ）</span>
                  <span>{formatEnergyDate(columns[columns.length - 1].date)}</span>
                </div>
              </div>
            )}

            {sources.length > 0 && (
              <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground">
                {sources.map((row) => (
                  <span key={row.source} className="flex items-center gap-1.5">
                    <span
                      className="size-2 rounded-[3px]"
                      style={{ backgroundColor: colors[row.source] ?? "#95a5a6" }}
                      aria-hidden
                    />
                    {row.label}
                    <span className="tabular-nums">
                      {row.this_month_kwh.toFixed(1)} kWh
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold">電気料金の単価</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={priceInput}
                  onChange={(e) => setPriceInput(e.target.value)}
                  aria-label="電気料金の単価（円/kWh）"
                  className="w-24 rounded-xl border bg-card px-2.5 py-1.5 text-right text-sm font-bold tabular-nums"
                />
                <span className="text-xs text-muted-foreground">円/kWh</span>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="ml-auto rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                エアコンの金額は白くまくんアプリが返す実額をそのまま使うため、この単価の影響を受けません。単価を掛けた目安になるのは、使用量（kWh）しか返さないスマートプラグなどです。
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11.5px] text-muted-foreground">
                <span>日別（直近{rows.length}日）</span>
                <span>kWh / 円</span>
              </div>
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  まだ使用量を受け取っていません
                </p>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.date}
                    className="flex items-center gap-2.5 text-[13px] tabular-nums"
                  >
                    <span className="w-[68px] shrink-0 text-muted-foreground">
                      {formatEnergyDateWithWeekday(row.date)}
                    </span>
                    <span className="flex h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      {buildEnergyStackSegments(row, sources, colors).map((segment) => (
                        <span
                          key={segment.source}
                          className="block h-full"
                          style={{
                            width: `${segment.share * 100}%`,
                            backgroundColor: segment.color,
                          }}
                        />
                      ))}
                    </span>
                    <span className="w-[62px] shrink-0 text-right font-bold">
                      {formatKwh(row.kwh)}
                    </span>
                    <span className="w-12 shrink-0 text-right text-muted-foreground">
                      {formatYen(row.cost_yen)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
