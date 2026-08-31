"use client";

import { useState } from "react";
import { useUnsavedEdits } from "@/lib/unsaved-edits";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_BACKDATE_DAYS,
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS,
  formatCleaningDateWithWeekday,
  formatCleaningInterval,
  formatHistoryAge,
  formatLastDone,
  formatMarkDoneLabel,
  formatRecordedAt,
  isSelectableDoneDate,
  shiftDate,
  toCleaningTaskInput,
  visibleHistory,
  type CleaningSchedule,
  type CleaningTask,
  type CleaningTaskInput,
} from "@/lib/cleaning";

/** シートの外枠。ゴミの日・電気料金の詳細パネルと同じ形にそろえる */
function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex min-h-0 items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex min-h-0 max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[88vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
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
          {children}
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] tracking-wider text-muted-foreground">{children}</p>
  );
}

interface CleaningDetailPanelProps {
  open: boolean;
  task: CleaningTask | null;
  /** サーバー（JST）の今日。「◯日前」の基準と、選べる日の上限にする */
  today: string;
  busy: boolean;
  onClose: () => void;
  onMarkDone: (task: CleaningTask, date: string) => void;
  onDeleteDone: (task: CleaningTask, date: string) => void;
}

/**
 * 掃除1件の詳細。やること・間隔・最近やった日を見て、その場で記録できる。
 *
 * 編集はここではなく「設定」に寄せた。1件だけ直したいときと、
 * 全体を見渡して増減させたいときは別の操作で、混ぜるとどちらも使いにくくなる。
 *
 * 開いているかどうかの判定だけをここで行い、中身は `DetailSheet` に分ける。
 * 入力の状態を持つのは中身のほうで、`key` に項目のidと今日を入れて
 * 「別の項目を開いた」「日付が変わった」ときに初期値から入れ直す。
 */
export function CleaningDetailPanel({ open, task, ...rest }: CleaningDetailPanelProps) {
  if (!open || !task) return null;
  return <DetailSheet key={`${task.id}:${rest.today}`} task={task} {...rest} />;
}

function DetailSheet({
  task,
  today,
  busy,
  onClose,
  onMarkDone,
  onDeleteDone,
}: Omit<CleaningDetailPanelProps, "open" | "task"> & { task: CleaningTask }) {
  // 掃除した日。初期値はサーバー（JST）の今日。当日に押し忘れたときだけ過去へずらす
  const [doneDate, setDoneDate] = useState(today);
  // 取り消しは押し間違えると次の掃除日が動くので、同じ行でもう一度押させる
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const history = visibleHistory(task);
  const yesterday = shiftDate(today, -1);
  const earliest = shiftDate(today, -MAX_BACKDATE_DAYS);
  const validDate = isSelectableDoneDate(doneDate, today);
  // 記録した直後はこれが立つ。押しても増えないボタンを押せるままにしておくと、
  // 記録できたのかどうかが画面から読めない
  const alreadyRecorded = task.history.some((item) => item.date === doneDate);

  return (
    <Sheet title={task.name} subtitle={formatCleaningInterval(task.interval_days)} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl bg-muted px-3.5 py-3">
          <p className="text-[11px] tracking-wider text-muted-foreground">次にやる日</p>
          <p className="text-[19px] font-bold leading-tight tabular-nums">
            {formatCleaningDateWithWeekday(task.next_due)}
          </p>
          <p className="text-xs text-muted-foreground">
            最後にやった日: {formatLastDone(task, today)}
          </p>
        </div>

        {task.steps.length > 0 && (
          <div>
            <FieldLabel>やること</FieldLabel>
            <ul className="flex flex-col gap-1.5">
              {task.steps.map((step, index) => (
                <li
                  key={`${step}-${index}`}
                  className="flex items-start gap-2.5 rounded-xl bg-muted px-3 py-2 text-sm"
                >
                  <span className="pt-0.5 text-[11px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">{step}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-col gap-2.5 rounded-2xl border border-emerald-600/60 p-3.5 dark:border-emerald-400/50">
          <div className="flex items-baseline gap-2">
            <FieldLabel>掃除した日</FieldLabel>
            <span className="ml-auto text-[11px] text-muted-foreground">
              今日より後は選べません
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="date"
              aria-label="掃除した日"
              value={doneDate}
              min={earliest}
              max={today}
              onChange={(event) => setDoneDate(event.target.value)}
              className="h-11 flex-1 tabular-nums"
            />
            <Button
              type="button"
              variant={doneDate === today ? "default" : "outline"}
              className="h-11 shrink-0 rounded-full px-4 text-[13px] font-bold"
              onClick={() => setDoneDate(today)}
            >
              今日
            </Button>
            <Button
              type="button"
              variant={doneDate === yesterday ? "default" : "outline"}
              className="h-11 shrink-0 rounded-full px-4 text-[13px] font-bold"
              onClick={() => setDoneDate(yesterday)}
            >
              昨日
            </Button>
          </div>

          <Button
            type="button"
            className="h-12 w-full rounded-2xl text-[15px] font-bold"
            disabled={busy || !validDate || alreadyRecorded}
            onClick={() => onMarkDone(task, doneDate)}
          >
            {busy
              ? "記録中..."
              : alreadyRecorded
                ? "この日は記録済み"
                : formatMarkDoneLabel(doneDate, today)}
          </Button>

          {!validDate && (
            <p className="text-xs text-destructive">
              今日から{MAX_BACKDATE_DAYS}日前までの日付を選んでください。
            </p>
          )}
        </div>

        <div>
          <FieldLabel>最近やった日</FieldLabel>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">まだ記録がありません</p>
          ) : (
            <div className="flex flex-col">
              {history.map((entry) => {
                const recordedAt = formatRecordedAt(entry);
                const confirming = pendingDelete === entry.date;
                return (
                  <div
                    key={entry.date}
                    className="flex items-baseline gap-2 border-t border-border py-1.5 text-sm tabular-nums first:border-t-0"
                  >
                    <span className="min-w-0">
                      {formatCleaningDateWithWeekday(entry.date)}
                      {recordedAt && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {recordedAt}
                        </span>
                      )}
                    </span>
                    <span className="ml-auto shrink-0 text-muted-foreground">
                      {formatHistoryAge(entry.date, today)}
                    </span>
                    {confirming ? (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingDelete(null);
                          onDeleteDone(task, entry.date);
                        }}
                        disabled={busy}
                        className="shrink-0 rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        取り消す
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPendingDelete(entry.date)}
                        disabled={busy}
                        className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
                        aria-label={`${entry.date}の記録を取り消す`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            日付を間違えたときは、その行を取り消してから正しい日で記録し直してください。
          </p>
        </div>
      </div>
    </Sheet>
  );
}

/** 設定シートで編集中の1件。手順は改行区切りの1つのテキストとして持つ */
interface CleaningDraft {
  id?: string;
  name: string;
  interval_days: string;
  steps: string;
}

function toDraft(task: CleaningTask): CleaningDraft {
  return {
    id: task.id,
    name: task.name,
    interval_days: String(task.interval_days),
    steps: task.steps.join("\n"),
  };
}

function toInput(draft: CleaningDraft): CleaningTaskInput {
  return toCleaningTaskInput({
    id: draft.id,
    name: draft.name,
    interval_days: draft.interval_days,
    steps: draft.steps.split("\n"),
  });
}

interface CleaningSettingsPanelProps {
  open: boolean;
  schedule: CleaningSchedule | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (tasks: CleaningTaskInput[]) => void;
}

/**
 * 掃除の場所・間隔・やることを編集する。
 *
 * 1件ずつ保存せず、開いている間の編集をまとめて `PUT /api/cleaning/tasks` で置き換える。
 * 追加・削除・並べ替えが1回の保存に収まり、途中で失敗しても中途半端な状態が残らない。
 */
export function CleaningSettingsPanel({
  open,
  schedule,
  saving,
  error,
  onClose,
  onSave,
}: CleaningSettingsPanelProps) {
  // 開いた時点の内容を編集の元にする。呼び出し側が開いている間だけこの要素を描くため、
  // 閉じると状態ごと消える。effect で開くたびに詰め直すより、初期値で持つほうが単純で、
  // 開いている間にサーバー側が変わっても入力中の値を上書きしない（保存で置き換わる）。
  const [drafts, setDrafts] = useState<CleaningDraft[]>(() =>
    (schedule?.tasks ?? []).map(toDraft)
  );
  // 開いている間は自動更新のリロードを止める。閉じるまで保存しないため、
  // 復帰時にそのままリロードすると入力が黙って消える（#277）
  useUnsavedEdits(open);

  if (!open) return null;

  const update = (index: number, patch: Partial<CleaningDraft>) => {
    setDrafts((current) =>
      current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft))
    );
  };

  const remove = (index: number) => {
    setDrafts((current) => current.filter((_, i) => i !== index));
  };

  const add = () => {
    setDrafts((current) => [...current, { name: "", interval_days: "7", steps: "" }]);
  };

  const named = drafts.filter((draft) => draft.name.trim().length > 0);

  return (
    <Sheet
      title="掃除の設定"
      subtitle="場所・間隔・やることを決める"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {drafts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            掃除する場所がまだありません。下の「場所を追加」から始めてください。
          </p>
        )}

        {drafts.map((draft, index) => (
          <div
            key={draft.id ?? `new-${index}`}
            className="flex flex-col gap-2.5 rounded-2xl border border-border p-3.5"
          >
            <div className="flex items-center gap-2">
              <Input
                value={draft.name}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder="場所（例: キッチンのシンク）"
                maxLength={40}
                className="h-10"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-destructive"
                aria-label={`${draft.name || "この場所"}を削除`}
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">間隔</span>
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_INTERVAL_DAYS}
                max={MAX_INTERVAL_DAYS}
                value={draft.interval_days}
                onChange={(event) => update(index, { interval_days: event.target.value })}
                className="h-10 w-24 tabular-nums"
              />
              <span className="text-sm text-muted-foreground">日に1回</span>
            </div>

            <div>
              <FieldLabel>やること（1行に1つ）</FieldLabel>
              <textarea
                value={draft.steps}
                onChange={(event) => update(index, { steps: event.target.value })}
                rows={3}
                placeholder={"排水口のゴミを捨てる\nスポンジで磨く"}
                className="border-input w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          className="h-11 w-full rounded-2xl"
          onClick={add}
        >
          <Plus className="size-4" />
          場所を追加
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            className="h-11 flex-1 rounded-2xl"
            onClick={onClose}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            className="h-11 flex-1 rounded-2xl font-bold"
            disabled={saving}
            onClick={() => onSave(named.map(toInput))}
          >
            {saving ? "保存中..." : "保存"}
          </Button>
        </div>

        {named.length < drafts.length && (
          <p className="text-xs text-muted-foreground">
            場所の名前が空の行は保存されません。
          </p>
        )}
      </div>
    </Sheet>
  );
}
