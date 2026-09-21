"use client";

import { ChevronRight, Printer } from "lucide-react";
import { LevelBar, SpoolSwatch } from "@/components/filament-parts";
import {
  collectBambuErrors,
  describeLastKnown,
  formatFinishAt,
  formatClock,
  formatObservedAt,
  formatRemaining,
  formatSpeedMode,
  formatTargetTemperature,
  formatTemperature,
  getBambuStatusPill,
  hasJobProgress,
  resolveBambuView,
  type BambuPrinterResponse,
  type BambuSnapshot,
  type BambuStatusPill,
  type BambuTone,
} from "@/lib/bambu";
import {
  LEVEL_TEXT_CLASS,
  describeBasis,
  formatGrams,
  formatLevelHint,
  formatStockSummary,
  getActiveSpool,
  type FilamentPayload,
} from "@/lib/filament";
import { cn } from "@/lib/utils";

interface PrinterCardProps {
  printer: BambuPrinterResponse | null;
  loading: boolean;
  error: boolean;
  /** フィラメント在庫（#445）。プリンターの接続とは別に取るので、無ければ欄ごと出さない */
  filament?: FilamentPayload | null;
  /** 残量の欄を押したときに在庫シートを開く */
  onOpenFilament?: () => void;
}

/** 状態の色。`--pc` に入れて、ピルの文字・背景と進捗バーがそこから読む */
const TONE_CLASSES: Record<BambuTone, string> = {
  live: "[--pc:var(--printer-color)]",
  ok: "[--pc:#24864f] dark:[--pc:#5fcf8b]",
  warn: "[--pc:#a86200] dark:[--pc:#f0b556]",
  bad: "[--pc:var(--destructive)]",
  idle: "[--pc:var(--muted-foreground)]",
};

function PrinterMessage({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

function StatusPill({ pill }: { pill: BambuStatusPill }) {
  return (
    <span
      className={cn(
        "ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-bold",
        "bg-[color-mix(in_srgb,var(--pc)_14%,transparent)] text-[color:var(--pc)]",
        TONE_CLASSES[pill.tone]
      )}
    >
      <span
        className={cn(
          "size-[7px] rounded-full bg-current",
          pill.live && "motion-safe:animate-pulse"
        )}
      />
      {pill.label}
    </span>
  );
}

function TemperatureCell({
  label,
  temperature,
  target,
}: {
  label: string;
  temperature: number | null;
  target: number | null;
}) {
  const targetText = formatTargetTemperature(target);
  return (
    <div className="reading-cell">
      <p className="reading-cell-label">{label}</p>
      <p className="reading-cell-value">
        {formatTemperature(temperature)}
        <span className="reading-cell-unit">
          °C{targetText ? ` / 目標 ${targetText}°C` : ""}
        </span>
      </p>
    </div>
  );
}

/**
 * 使用中スプールの残量と、在庫シートへの入口（#445）。
 *
 * **プリンターの接続状態とは関係なく出す。** 在庫はアプリの中の記録で、プリンターがオフラインでも
 * 残量は変わらず、こういうときこそ買い足す判断に使う。
 */
function FilamentStock({
  filament,
  onOpen,
}: {
  filament: FilamentPayload;
  onOpen: () => void;
}) {
  const active = getActiveSpool(filament);
  const hint = active ? formatLevelHint(active) : null;
  return (
    <div className="mt-3.5 border-t border-border pt-3">
      <p className="mb-2 text-[11px] tracking-wider text-muted-foreground">フィラメント残量</p>
      <button
        type="button"
        onClick={onOpen}
        aria-label="フィラメント在庫を開く"
        className="block w-full rounded-2xl bg-muted px-3 py-2.5 text-left transition-colors hover:bg-accent"
      >
        {!filament.configured ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            スプールを登録すると、残量を計算します
            <ChevronRight className="ml-auto size-4 shrink-0" />
          </span>
        ) : (
          <>
            {active ? (
              <>
                <span className="flex items-center gap-2.5">
                  <SpoolSwatch color={active.color} className="size-[26px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold leading-snug text-foreground">
                      {active.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {describeBasis(active)}
                    </span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                    <b className={cn("text-2xl leading-none", LEVEL_TEXT_CLASS[active.level])}>
                      {formatGrams(active.remaining_g)}
                    </b>
                    {" g / "}
                    {active.percent}%
                    {hint && <span className="block text-[11px] font-bold">{hint}</span>}
                  </span>
                </span>
                <span className="mt-2 block">
                  <LevelBar spool={active} label={`${active.name}の残量`} />
                </span>
              </>
            ) : (
              <span className="block text-sm text-muted-foreground">
                使用中のスプールが選ばれていません
              </span>
            )}
            <span className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{formatStockSummary(filament)}</span>
              <span className="flex items-center font-bold text-[color:var(--printer-color)]">
                在庫を開く
                <ChevronRight className="size-3.5" />
              </span>
            </span>
          </>
        )}
      </button>
    </div>
  );
}

function ErrorAlert({ snapshot }: { snapshot: BambuSnapshot }) {
  const errors = collectBambuErrors(snapshot);
  if (errors.length === 0) return null;
  return (
    <div className="mt-3 rounded-[14px] bg-destructive/10 px-3 py-2.5 text-[13px] leading-relaxed">
      <b className="text-destructive">エラー</b>
      {errors.map((item) => (
        <p key={item.code}>
          <code className="font-mono text-xs">{item.code}</code>
          {item.severityLabel ? `（${item.severityLabel}）` : ""}
        </p>
      ))}
    </div>
  );
}

function JobProgress({ snapshot, nowIso }: { snapshot: BambuSnapshot; nowIso: string }) {
  const { job, state } = snapshot;
  const percent = job.progressPercent ?? 0;
  const running = state === "printing" || state === "preparing" || state === "paused";
  const finishText = state === "printing" || state === "preparing"
    ? formatFinishAt(job.estimatedFinishAt, nowIso)
    : null;
  const speed = running ? formatSpeedMode(snapshot.speed.mode) : null;
  const layers =
    job.layer != null && job.totalLayers != null && job.totalLayers > 0
      ? `${job.layer} / ${job.totalLayers} 層`
      : null;

  return (
    <>
      <p className="truncate text-[15px] font-bold leading-snug text-foreground">
        {job.name ?? "印刷"}
      </p>
      <div className="mt-2.5 flex items-end gap-3">
        <span className="device-card-value">
          {percent}
          <span className="device-card-unit">%</span>
        </span>
        <span className="ml-auto text-right text-xs leading-normal tabular-nums text-muted-foreground">
          {running && job.remainingMinutes != null ? (
            <b className="block text-sm text-foreground">
              残り {formatRemaining(job.remainingMinutes)}
            </b>
          ) : null}
          {state === "finished" ? (
            <b className="block text-sm text-foreground">印刷が終わりました</b>
          ) : null}
          {state === "failed" ? (
            <b className="block text-sm text-foreground">印刷が止まりました</b>
          ) : null}
          {finishText}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="印刷の進み具合"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-[color:var(--pc)]"
          style={{ width: `${percent}%` }}
        />
      </div>
      {(layers || speed) && (
        <p className="mt-2 flex flex-wrap gap-x-3.5 text-xs tabular-nums text-muted-foreground">
          {layers && <span>{layers}</span>}
          {speed && <span>速度 {speed}</span>}
        </p>
      )}
    </>
  );
}

/** 「最後に確認した状態」。現在値ではないので、温度や進捗の枠は出さず1行だけにする */
function LastKnown({
  snapshot,
  at,
}: {
  snapshot: BambuSnapshot | null;
  at: string | null;
}) {
  if (!snapshot) return null;
  return (
    <div className="mt-3 rounded-[14px] bg-muted px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
      <span className="mb-0.5 block text-[11px] tracking-wide">
        最後に確認した状態{at ? `・${at}` : ""}
      </span>
      <b className="font-bold text-foreground">{describeLastKnown(snapshot)}</b>
    </div>
  );
}

function CurrentBody({
  snapshot,
  printer,
}: {
  snapshot: BambuSnapshot;
  printer: BambuPrinterResponse;
}) {
  const updatedAt = formatClock(printer.lastUpdateAt);
  return (
    <>
      {hasJobProgress(snapshot) ? (
        <JobProgress snapshot={snapshot} nowIso={printer.fetchedAt} />
      ) : snapshot.state === "unknown" ? (
        <PrinterMessage>プリンターの状態を読み取れませんでした。</PrinterMessage>
      ) : (
        <p className="text-sm text-foreground">印刷していません。</p>
      )}
      <ErrorAlert snapshot={snapshot} />
      <div className="mt-3.5 grid grid-cols-2 gap-2">
        <TemperatureCell
          label="ノズル"
          temperature={snapshot.nozzle.temperature}
          target={snapshot.nozzle.target}
        />
        <TemperatureCell
          label="ベッド"
          temperature={snapshot.bed.temperature}
          target={snapshot.bed.target}
        />
      </div>
      {updatedAt && (
        <p className="mt-3 text-[11.5px] tabular-nums text-muted-foreground">{updatedAt} 時点</p>
      )}
    </>
  );
}

/**
 * 3Dプリンター（Bambu Lab A1 mini）のカード（#436）。
 *
 * 読むだけで、押しても何も起きない。**接続していない・収集が止まっているときは現在値を
 * 出さず**、最後に受け取った状態を「最後に確認した状態」として添えるだけにする
 * （古い温度や進捗を「いま」として見せない）。
 */
export function PrinterCard({
  printer,
  loading,
  error,
  filament = null,
  onOpenFilament,
}: PrinterCardProps) {
  const view = printer ? resolveBambuView(printer) : null;

  let pill: BambuStatusPill | null = null;
  let tone: BambuTone = "idle";
  if (view?.kind === "current") {
    pill = getBambuStatusPill(view.snapshot);
    tone = pill.tone;
  } else if (view?.kind === "offline") {
    pill = { label: "オフライン", tone: "idle", live: false };
  } else if (view?.kind === "stale") {
    pill = { label: "情報が古い", tone: "warn", live: false };
    tone = "warn";
  }

  return (
    <div className={cn("device-card", TONE_CLASSES[tone])}>
      <div className="mb-3 flex items-center gap-2">
        <Printer className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <p className="device-card-title whitespace-nowrap">3Dプリンター</p>
        <span className="whitespace-nowrap text-[11.5px] text-muted-foreground">A1 mini</span>
        {!loading && !error && pill && <StatusPill pill={pill} />}
      </div>

      {loading && <PrinterMessage>読み込み中...</PrinterMessage>}

      {!loading && error && (
        <p className="text-sm text-destructive">3Dプリンターの状態を読み込めませんでした</p>
      )}

      {!loading && !error && printer && view?.kind === "current" && (
        <CurrentBody snapshot={view.snapshot} printer={printer} />
      )}

      {!loading && !error && printer && view?.kind === "offline" && (
        <div className="opacity-90">
          <PrinterMessage>
            プリンターに繋がっていません。電源とWi-Fiを確認してください。
          </PrinterMessage>
          <LastKnown
            snapshot={view.lastKnown}
            at={formatObservedAt(printer.lastMessageAt, printer.fetchedAt)}
          />
        </div>
      )}

      {!loading && !error && printer && view?.kind === "stale" && (
        <div className="opacity-90">
          <PrinterMessage>
            {Math.max(1, Math.round(printer.staleThresholdSeconds / 60))}
            分以上、プリンターの状態が届いていません。サブPCの収集が止まっている可能性があります。
          </PrinterMessage>
          <LastKnown
            snapshot={view.lastKnown}
            at={formatObservedAt(printer.lastUpdateAt, printer.fetchedAt)}
          />
        </div>
      )}

      {!loading && !error && printer && view?.kind === "no_data" && (
        <PrinterMessage>
          3Dプリンターの状態がまだ届いていません（サブPCの収集を起動すると、ここに出ます）
        </PrinterMessage>
      )}

      {!loading && filament && onOpenFilament && (
        <FilamentStock filament={filament} onOpen={onOpenFilament} />
      )}
    </div>
  );
}
