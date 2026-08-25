"use client";

import { X } from "lucide-react";
import {
  BILL_ELECTRICITY_COLOR,
  BILL_GAS_COLOR,
  buildBillMonthRows,
  buildBillStackColumns,
  formatBillUsage,
  formatBillingMonth,
  formatBillingMonthShort,
} from "@/lib/bills";
import { formatYen } from "@/lib/energy";
import type { UtilityBillSummary } from "@/lib/types";

interface BillDetailPanelProps {
  open: boolean;
  summary: UtilityBillSummary | null;
  onClose: () => void;
}

function Tile({
  caption,
  amountYen,
  sub,
}: {
  caption: string;
  amountYen: number | null;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-muted px-3 py-2.5">
      <div className="text-[11px] leading-tight text-muted-foreground">{caption}</div>
      <div className="mt-0.5 text-[18px] font-bold leading-tight tracking-tight tabular-nums">
        {formatYen(amountYen)}
      </div>
      {sub && (
        <div className="text-[11.5px] text-muted-foreground tabular-nums">{sub}</div>
      )}
    </div>
  );
}

/**
 * 電気・ガス料金カードの詳細。
 *
 * 月ごとの請求は年に12回しか動かないので、日別のような密なグラフにはしない。
 * 記録のある月だけを積み上げ棒で並べ、下に金額と使用量の一覧を置く。
 */
export function BillDetailPanel({ open, summary, onClose }: BillDetailPanelProps) {
  if (!open) return null;

  const months = summary?.months ?? [];
  const columns = buildBillStackColumns(months);
  const rows = buildBillMonthRows(months);
  const latest = summary?.latest ?? null;
  const measured = summary?.measured ?? null;

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[88vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">電気・ガス料金</h2>
            <p className="text-xs text-muted-foreground">
              {latest
                ? `最新は ${formatBillingMonth(latest.billing_month)}`
                : "請求のお知らせ待ち"}
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
            {latest && (
              <div className="grid grid-cols-3 gap-2">
                <Tile
                  caption="電気"
                  amountYen={latest.electricity?.amount_yen ?? null}
                  sub={formatBillUsage(latest.electricity)}
                />
                <Tile
                  caption="ガス"
                  amountYen={latest.gas?.amount_yen ?? null}
                  sub={formatBillUsage(latest.gas)}
                />
                <Tile
                  caption={`直近${months.length}か月`}
                  amountYen={summary?.total_yen ?? null}
                  sub="電気＋ガス"
                />
              </div>
            )}

            {columns.length > 1 && (
              <div className="flex flex-col gap-2">
                <div className="flex h-[120px] items-end gap-[5px]">
                  {columns.map((column) => (
                    <div
                      key={column.billingMonth}
                      className="flex min-w-0 flex-1 flex-col justify-end gap-[1.5px]"
                      style={{ height: `${Math.max(4, column.ratio * 100)}%` }}
                      title={`${formatBillingMonth(column.billingMonth)} ${formatYen(
                        column.totalYen
                      )}`}
                    >
                      {/* 上から積むので、下に置きたい電気を後ろに回す */}
                      {[...column.segments].reverse().map((segment) => (
                        <span
                          key={segment.kind}
                          className="block min-h-px rounded-[2px]"
                          style={{
                            height: `${segment.share * 100}%`,
                            backgroundColor: segment.color,
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="flex gap-[5px] border-t pt-1.5 text-[10.5px] text-muted-foreground tabular-nums">
                  {columns.map((column) => (
                    <span
                      key={column.billingMonth}
                      className="min-w-0 flex-1 truncate text-center"
                    >
                      {formatBillingMonthShort(column.billingMonth)}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-[3px]"
                  style={{ backgroundColor: BILL_ELECTRICITY_COLOR }}
                  aria-hidden
                />
                電気
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-[3px]"
                  style={{ backgroundColor: BILL_GAS_COLOR }}
                  aria-hidden
                />
                ガス
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11.5px] text-muted-foreground">
                <span>請求月（記録のある月だけ）</span>
                <span>電気 / ガス / 合計</span>
              </div>
              {rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  まだ請求のお知らせを受け取っていません
                </p>
              ) : (
                rows.map((row) => (
                  <div
                    key={row.billing_month}
                    className="flex items-center gap-2 text-[13px] tabular-nums"
                  >
                    <span className="w-[74px] shrink-0 text-muted-foreground">
                      {formatBillingMonth(row.billing_month)}
                    </span>
                    <span className="w-[68px] shrink-0 text-right">
                      {formatYen(row.electricity?.amount_yen)}
                    </span>
                    <span className="w-[62px] shrink-0 text-right text-muted-foreground">
                      {formatYen(row.gas?.amount_yen)}
                    </span>
                    <span className="ml-auto font-bold">
                      {formatYen(row.total_yen)}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-col gap-1.5 border-t pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
              <p>
                関西電力「はぴeみる電」から届く検針結果のメールを読み取っています。検針日から原則5営業日以内に届き、そのタイミングで更新されます。今月ぶんは検針が終わるまで確定しないため、最新は原則「先月分」です。
              </p>
              {measured?.share_percent != null && (
                <p>
                  同じ月にエアコンとスマートプラグで計測できたのは{" "}
                  {formatYen(measured.cost_yen)}（{measured.kwh} kWh）で、電気の請求額の{" "}
                  {measured.share_percent}% にあたります。請求の対象期間は検針日から検針日までで暦月とはずれるため、この割合は目安です。
                </p>
              )}
              <p>
                日ごと・時間ごとの使用量はメールに含まれていません（はぴeみる電の画面にのみあります）。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
