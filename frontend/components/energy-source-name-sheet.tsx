"use client";

import { useState } from "react";
import { RotateCcw, X, Zap } from "lucide-react";
import { useUnsavedEdits } from "@/lib/unsaved-edits";
import type { EnergySourceRow } from "@/lib/types";

/** 別名に付けられる長さ。`backend/ui_settings.py` の `MAX_ENERGY_SOURCE_NAME_LENGTH` と同じ */
export const MAX_ENERGY_SOURCE_NAME_LENGTH = 20;

interface EnergySourceNameSheetProps {
  /** 名前を付け替えられる取得元（スマートプラグ）。並びは消費電力カードと同じ */
  sources: readonly EnergySourceRow[];
  /** 取得元 -> 色。行の先頭に出す四角に使う */
  colors: Record<string, string>;
  onClose: () => void;
  /** 保存。渡すのは「別名を付けた取得元だけ」の辞書 */
  onSave: (names: Record<string, string>) => Promise<void>;
}

/**
 * 入力欄の初期値。**既定の名前のままなら空にする**（#335）。
 *
 * 空欄にはプレースホルダとして既定の名前が出るので、「上書きしていない」ことが
 * そのまま見える。`remote-button-settings-sheet.tsx` と同じ考え方。
 */
export function buildEnergyNameDrafts(
  sources: readonly EnergySourceRow[]
): Record<string, string> {
  const drafts: Record<string, string> = {};
  for (const row of sources) {
    drafts[row.source] = row.label === row.default_label ? "" : row.label;
  }
  return drafts;
}

/** 保存する形へ。空欄（＝上書きなし）の取得元はキーごと落とす */
export function buildEnergyNameUpdate(
  drafts: Record<string, string>
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const [source, value] of Object.entries(drafts)) {
    const name = value.trim();
    if (name) names[source] = name;
  }
  return names;
}

/**
 * 消費電力の取得元（スマートプラグ）に付ける名前を決めるシート（#335）。
 *
 * 取得元の名前はTapoアプリで付けたものが `daily_energy.source`（`tapo:冷蔵庫`）に
 * そのまま入っている。**ここで変えるのは表示名だけで、`source` は変えない。**
 * `source` を書き換えると `(date, source)` が別物になり、過去の使用量と切れる。
 *
 * **開いている間だけ呼び出し側がマウントする。** 入力途中の値は閉じれば消えるべきなので、
 * 状態を持ち越さずに毎回 `sources` から作り直す。
 */
export function EnergySourceNameSheet({
  sources,
  colors,
  onClose,
  onSave,
}: EnergySourceNameSheetProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    buildEnergyNameDrafts(sources)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // 「保存する」を押すまでサーバーには書かない。開いている間は自動更新の
  // リロードを止め、書きかけの入力を捨てないようにする（#277）
  useUnsavedEdits();

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(buildEnergyNameUpdate(drafts));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[20px] bg-card shadow-lg sm:max-h-[85vh] sm:rounded-[20px]">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Zap
              className="size-5 shrink-0"
              strokeWidth={1.9}
              style={{ color: "var(--energy-color)" }}
            />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold">取得元の名前</h2>
              <p className="truncate text-sm text-muted-foreground">
                スマートプラグ {sources.length} 台
              </p>
            </div>
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

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-5 py-4">
          {sources.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              名前を変えられるスマートプラグがありません。使用量を受け取ると、ここに並びます。
            </p>
          ) : (
            <>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                アプリの中での呼び名を決めます。空にすると、Tapoアプリで付けた名前に戻ります。
              </p>

              {sources.map((row) => {
                const draft = drafts[row.source] ?? "";
                const inputId = `energy-source-name-${row.source}`;
                return (
                  <div key={row.source} className="flex flex-col gap-1.5">
                    <label
                      htmlFor={inputId}
                      className="flex items-center gap-2 text-[13px] font-bold"
                    >
                      <span
                        className="size-2 shrink-0 rounded-[3px]"
                        style={{ backgroundColor: colors[row.source] ?? "#95a5a6" }}
                        aria-hidden
                      />
                      <span className="truncate">{row.default_label}</span>
                      <code className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-normal text-muted-foreground">
                        {row.source}
                      </code>
                    </label>
                    <input
                      id={inputId}
                      type="text"
                      value={draft}
                      maxLength={MAX_ENERGY_SOURCE_NAME_LENGTH}
                      placeholder={row.default_label}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [row.source]: e.target.value }))
                      }
                      className="rounded-xl border bg-card px-3 py-2 text-sm"
                    />
                    <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
                      <span className="truncate">Tapoの名前: {row.default_label}</span>
                      {draft.trim() && (
                        <button
                          type="button"
                          onClick={() =>
                            setDrafts((prev) => ({ ...prev, [row.source]: "" }))
                          }
                          className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 transition-colors hover:bg-accent"
                        >
                          <RotateCcw className="size-3" strokeWidth={2.2} />
                          既定に戻す
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              <p className="border-t pt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                名前を変えても、これまでの使用量の記録はそのまま引き継がれます。
              </p>
            </>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="shrink-0 border-t px-5 py-4">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || sources.length === 0}
            className="h-11 w-full rounded-xl bg-foreground text-sm font-bold text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存する"}
          </button>
        </div>
      </div>
    </div>
  );
}
