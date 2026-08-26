"use client";

import { useMemo, useState } from "react";
import { Eye, EyeOff, Lightbulb, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  REMOTE_LABEL_MAX_LENGTH,
  type RemoteButtons,
  type RemoteButtonSetting,
} from "@/lib/remote";
import { cn } from "@/lib/utils";

interface RemoteButtonSettingsSheetProps {
  onClose: () => void;
  /** `/api/remote/buttons` の応答。隠したボタンも含んだ全件が入っている */
  buttons: RemoteButtons | null;
  onSave: (settings: Record<string, RemoteButtonSetting>) => Promise<void>;
}

interface Draft {
  label: string;
  hidden: boolean;
}

/** 画面に出ている値から、保存する設定を組み立てる。既定と同じ行はバックエンドが落とす */
function buildSettings(drafts: Record<string, Draft>): Record<string, RemoteButtonSetting> {
  const settings: Record<string, RemoteButtonSetting> = {};
  for (const [id, draft] of Object.entries(drafts)) {
    settings[id] = { label: draft.label.trim(), hidden: draft.hidden };
  }
  return settings;
}

/** サーバーから来た一覧を入力欄の初期値へ。元の名前のままの行は空欄にする */
function buildDrafts(buttons: RemoteButtons | null): Record<string, Draft> {
  const drafts: Record<string, Draft> = {};
  for (const group of buttons?.groups ?? []) {
    for (const button of group.buttons) {
      const original = button.default_label ?? button.label;
      drafts[button.id] = {
        // 元の名前のままなら空にして、プレースホルダで元の名前を見せる
        label: button.label === original ? "" : button.label,
        hidden: button.hidden ?? false,
      };
    }
  }
  return drafts;
}

/**
 * 「電気の操作」に出すボタンを選び、名前を付け替えるシート。
 *
 * ボタン定義そのもの（どの機器へ何を送るか）はここでは触らない。触れるのは
 * 「画面に出す名前」と「ダッシュボードに出すかどうか」だけで、元の定義は
 * `data/remote.json` に残る。名前を空にすると元の名前へ戻る（#260）。
 *
 * **開いている間だけ呼び出し側がマウントする。** 入力途中の値は閉じれば消えるべきなので、
 * 状態を持ち越さずに毎回サーバーの値から作り直す。
 */
export function RemoteButtonSettingsSheet({
  onClose,
  buttons,
  onSave,
}: RemoteButtonSettingsSheetProps) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => buildDrafts(buttons));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const total = useMemo(() => Object.keys(drafts).length, [drafts]);
  const visibleCount = useMemo(
    () => Object.values(drafts).filter((draft) => !draft.hidden).length,
    [drafts]
  );

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(buildSettings(drafts));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const groups = buttons?.groups ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-[20px] bg-card shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Lightbulb
              className="size-5 shrink-0"
              strokeWidth={1.75}
              style={{ color: "var(--remote-color)" }}
            />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold">電気の操作のボタン</h2>
              <p className="truncate text-sm text-muted-foreground">
                出すボタンと、その名前を決めます
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

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              操作するボタンが未設定です（data/remote.json に登録すると表示されます）
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <div key={group.id}>
                  <p className="ml-0.5 mb-2 text-[11px] tracking-wider text-muted-foreground">
                    {group.name}
                  </p>
                  <div className="flex flex-col gap-2">
                    {group.buttons.map((button) => {
                      const draft = drafts[button.id];
                      if (!draft) return null;
                      const original = button.default_label ?? button.label;
                      const inputId = `remote-label-${button.id}`;
                      return (
                        <div
                          key={button.id}
                          className={cn(
                            "flex items-center gap-2.5 rounded-[14px] border px-3 py-2",
                            draft.hidden && "bg-muted"
                          )}
                        >
                          <div className={cn("min-w-0 flex-1", draft.hidden && "opacity-50")}>
                            <label htmlFor={inputId} className="sr-only">
                              {original}の名前
                            </label>
                            <Input
                              id={inputId}
                              value={draft.label}
                              placeholder={original}
                              maxLength={REMOTE_LABEL_MAX_LENGTH}
                              onChange={(event) =>
                                updateDraft(button.id, { label: event.target.value })
                              }
                              className="h-9 rounded-xl"
                            />
                            {draft.label.trim() ? (
                              <p className="mt-1 truncate text-xs text-muted-foreground">
                                もとの名前: {original}
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!draft.hidden}
                            onClick={() => updateDraft(button.id, { hidden: !draft.hidden })}
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
                              draft.hidden
                                ? "bg-muted text-muted-foreground hover:bg-accent"
                                : "bg-foreground text-background"
                            )}
                            aria-label={
                              draft.hidden
                                ? `${original}をダッシュボードに出さない`
                                : `${original}をダッシュボードに出す`
                            }
                          >
                            {draft.hidden ? (
                              <EyeOff className="size-4" strokeWidth={1.75} />
                            ) : (
                              <Eye className="size-4" strokeWidth={1.75} />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <p className="text-xs leading-relaxed text-muted-foreground">
                ダッシュボードには{visibleCount}件出ます（全{total}件中）。
                名前を空にすると、もとの名前へ戻ります。
              </p>
            </div>
          )}

          {error ? (
            <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          {groups.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-opacity disabled:opacity-60"
            >
              {saving ? "保存中..." : "保存する"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
