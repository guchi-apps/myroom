"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { updateUiSettings } from "@/lib/api";
import {
  buildEnergyDailyRows,
  energyRowRatio,
  formatEnergyDate,
  formatEnergyDateWithWeekday,
  formatKwh,
  formatYen,
} from "@/lib/energy";
import type { EnergySummary, EnergyTotal } from "@/lib/types";

interface EnergyDetailPanelProps {
  open: boolean;
  summary: EnergySummary | null;
  onClose: () => void;
  /** 単価を保存したあと。集計をやり直すために親へ知らせる */
  onUnitPriceSaved: (unitPrice: number) => void;
}

function Tile({ caption, total }: { caption: string; total: EnergyTotal }) {
  return (
    <div className="rounded-2xl bg-muted px-3.5 py-2.5">
      <div className="text-[11px] text-muted-foreground">
        {caption}（{formatEnergyDate(total.start)}〜{formatEnergyDate(total.end)}）
      </div>
      <div className="text-[19px] font-bold leading-tight tracking-tight tabular-nums">
        {formatYen(total.cost_yen)}
      </div>
      <div className="text-[11.5px] text-muted-foreground tabular-nums">
        {formatKwh(total.kwh)}
      </div>
    </div>
  );
}

/** 電気代カードの詳細。日別の一覧と、金額の計算に使う単価を変更できる */
export function EnergyDetailPanel({
  open,
  summary,
  onClose,
  onUnitPriceSaved,
}: EnergyDetailPanelProps) {
  // 親が `open` のときだけマウントするため、初期値をここで決めれば開くたびに入れ直される
  const [priceInput, setPriceInput] = useState(() =>
    summary ? String(summary.unit_price) : ""
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const rows = buildEnergyDailyRows(summary);

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
            <h2 className="truncate text-lg font-bold">エアコンの電気代</h2>
            <p className="text-xs text-muted-foreground">
              AirCloud Home（白くまくんアプリ）
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
            {summary && (
              <div className="grid grid-cols-2 gap-2.5">
                <Tile caption="今月" total={summary.this_month} />
                <Tile caption="先月" total={summary.last_month} />
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
                取得できるのは使用量（kWh）だけなので、金額はこの単価を掛けた目安です。白くまくんアプリに設定している単価と揃えると表示が一致します。
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
                    className="flex items-baseline gap-2.5 text-[13px] tabular-nums"
                  >
                    <span className="w-[68px] shrink-0 text-muted-foreground">
                      {formatEnergyDateWithWeekday(row.date)}
                    </span>
                    <span className="w-[68px] shrink-0 text-right">
                      {formatKwh(row.kwh)}
                    </span>
                    <span className="w-14 shrink-0 text-right text-muted-foreground">
                      {formatYen(row.cost_yen)}
                    </span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${energyRowRatio(rows, row) * 100}%`,
                          backgroundColor: "var(--energy-color)",
                        }}
                      />
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
