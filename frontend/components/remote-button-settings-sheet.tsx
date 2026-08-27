"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lightbulb,
  Plus,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { RemoteCatalogSheet } from "@/components/remote-catalog-sheet";
import {
  REMOTE_LABEL_MAX_LENGTH,
  applyCatalogSelection,
  buildRemoteConfigUpdate,
  collectDraftButtonIds,
  moveRemoteButton,
  moveRemoteGroup,
  removeRemoteButton,
  toGroupDrafts,
  type RemoteButtons,
  type RemoteCatalog,
  type RemoteConfigUpdate,
  type RemoteGroupDraft,
} from "@/lib/remote";
import { cn } from "@/lib/utils";

interface RemoteButtonSettingsSheetProps {
  onClose: () => void;
  /** `/api/remote/buttons` の応答。隠したボタンも含んだ全件が入っている */
  buttons: RemoteButtons | null;
  onSave: (update: RemoteConfigUpdate) => Promise<void>;
}

interface Draft {
  label: string;
  hidden: boolean;
  /** 定義側（Nature Remo 側）の名前。保存時に添えて、設定が別のボタンへずれるのを防ぐ */
  defaultLabel: string;
}

/** 画面に出ている値から、保存する設定を組み立てる。既定と同じ行はバックエンドが落とす */
function buildSettings(drafts: Record<string, Draft>) {
  return Object.fromEntries(
    Object.entries(drafts).map(([id, draft]) => [
      id,
      { label: draft.label.trim(), hidden: draft.hidden, default_label: draft.defaultLabel },
    ])
  );
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
        defaultLabel: original,
      };
    }
  }
  return drafts;
}

/**
 * 「電気の操作」に並べるボタンを登録し、名前を付け替えるシート。
 *
 * 触れるのは「どの操作をボタンにするか」（#262）、「画面に出す名前」
 * 「ダッシュボードに出すかどうか」（#260）、そして「並び順」（#269）。
 * 名前を空にすると Nature Remo 側の名前へ戻る。
 *
 * **保存ボタンは1つだけ。** 候補一覧で選んだ内容もここへ取り込まれるだけで、
 * 「保存する」を押すまでサーバーには書かない。
 *
 * **開いている間だけ呼び出し側がマウントする。** 入力途中の値は閉じれば消えるべきなので、
 * 状態を持ち越さずに毎回サーバーの値から作り直す。
 */
export function RemoteButtonSettingsSheet({
  onClose,
  buttons,
  onSave,
}: RemoteButtonSettingsSheetProps) {
  const [groups, setGroups] = useState<RemoteGroupDraft[]>(() => toGroupDrafts(buttons));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => buildDrafts(buttons));
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const registered = useMemo(() => collectDraftButtonIds(groups), [groups]);
  const total = registered.size;
  const visibleCount = useMemo(
    () => [...registered].filter((id) => !drafts[id]?.hidden).length,
    [registered, drafts]
  );

  const updateDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  /** 候補一覧で決めた選択を取り込む。新しく増えたボタンには空のドラフトを用意する */
  const handleCatalogConfirm = (selected: Set<string>, catalog: RemoteCatalog) => {
    const next = applyCatalogSelection(groups, catalog, selected);
    setGroups(next);
    setDrafts((prev) => {
      const merged: Record<string, Draft> = {};
      for (const group of next) {
        for (const button of group.buttons) {
          merged[button.id] = prev[button.id] ?? {
            label: "",
            hidden: false,
            defaultLabel: button.defaultLabel,
          };
        }
      }
      return merged;
    });
    setCatalogOpen(false);
  };

  const handleSave = async () => {
    // 名前の無いグループはバックエンドが丸ごと捨てる。黙ってボタンごと消えるので、
    // ここで止めて理由を出す
    if (groups.some((group) => !group.name.trim())) {
      setError("グループの名前を入れてください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(buildRemoteConfigUpdate(groups, buildSettings(drafts)));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
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
                  出すボタンと、名前・並び順を決めます
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
            <button
              type="button"
              onClick={() => setCatalogOpen(true)}
              className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed text-sm font-bold transition-colors hover:bg-accent"
              style={{ borderColor: "var(--remote-color)" }}
            >
              <Plus className="size-4" strokeWidth={2} />
              Nature Remo から選ぶ
            </button>

            {groups.length === 0 ? (
              <p className="py-6 text-center text-sm leading-relaxed text-muted-foreground">
                まだボタンがありません。
                <br />
                「Nature Remo から選ぶ」から登録できます。
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-3">
                {groups.map((group, groupIndex) => (
                  <div
                    key={group.id}
                    className="flex flex-col gap-2 rounded-2xl border px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <label htmlFor={`remote-group-${group.id}`} className="sr-only">
                        {group.name}の見出し
                      </label>
                      <Input
                        id={`remote-group-${group.id}`}
                        value={group.name}
                        maxLength={REMOTE_LABEL_MAX_LENGTH}
                        onChange={(event) =>
                          setGroups((prev) =>
                            prev.map((entry, index) =>
                              index === groupIndex
                                ? { ...entry, name: event.target.value }
                                : entry
                            )
                          )
                        }
                        className="h-8 rounded-[10px] font-bold"
                      />
                      <button
                        type="button"
                        onClick={() => setGroups((prev) => moveRemoteGroup(prev, groupIndex, -1))}
                        disabled={groupIndex === 0}
                        className="flex size-7 shrink-0 items-center justify-center rounded-[9px] border text-muted-foreground transition-opacity hover:bg-accent disabled:opacity-35"
                        aria-label={`${group.name}を上へ`}
                      >
                        <ArrowUp className="size-3.5" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroups((prev) => moveRemoteGroup(prev, groupIndex, 1))}
                        disabled={groupIndex === groups.length - 1}
                        className="flex size-7 shrink-0 items-center justify-center rounded-[9px] border text-muted-foreground transition-opacity hover:bg-accent disabled:opacity-35"
                        aria-label={`${group.name}を下へ`}
                      >
                        <ArrowDown className="size-3.5" strokeWidth={2} />
                      </button>
                    </div>

                    {group.buttons.map((button, buttonIndex) => {
                      const draft = drafts[button.id];
                      if (!draft) return null;
                      const original = button.defaultLabel;
                      const inputId = `remote-label-${button.id}`;
                      return (
                        <div key={button.id} className="flex items-center gap-2">
                          {/*
                            並び順の上下（#269）。グループの並べ替えと同じ操作だが、
                            行の幅を食わないよう縦に積んで28pxに収める
                          */}
                          <div className="flex w-7 shrink-0 flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() =>
                                setGroups((prev) =>
                                  moveRemoteButton(prev, groupIndex, buttonIndex, -1)
                                )
                              }
                              disabled={buttonIndex === 0}
                              className="flex h-[17px] items-center justify-center rounded-md bg-secondary text-foreground transition-opacity hover:bg-accent disabled:opacity-30"
                              aria-label={`${original}を上へ`}
                            >
                              <ChevronUp className="size-3" strokeWidth={2.5} />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setGroups((prev) =>
                                  moveRemoteButton(prev, groupIndex, buttonIndex, 1)
                                )
                              }
                              disabled={buttonIndex === group.buttons.length - 1}
                              className="flex h-[17px] items-center justify-center rounded-md bg-secondary text-foreground transition-opacity hover:bg-accent disabled:opacity-30"
                              aria-label={`${original}を下へ`}
                            >
                              <ChevronDown className="size-3" strokeWidth={2.5} />
                            </button>
                          </div>
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
                                ? `${original}をダッシュボードに出す`
                                : `${original}をダッシュボードに出さない`
                            }
                          >
                            {draft.hidden ? (
                              <EyeOff className="size-4" strokeWidth={1.75} />
                            ) : (
                              <Eye className="size-4" strokeWidth={1.75} />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setGroups((prev) => removeRemoteButton(prev, button.id))
                            }
                            className="flex size-9 shrink-0 items-center justify-center rounded-full text-destructive transition-colors hover:bg-destructive/10"
                            aria-label={`${original}を登録から外す`}
                          >
                            <X className="size-4" strokeWidth={2} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}

                <p className="text-xs leading-relaxed text-muted-foreground">
                  ダッシュボードには{visibleCount}件出ます（全{total}件中）。
                  名前を空にすると、もとの名前へ戻ります。上下の矢印で並び順を変えられます。
                </p>
              </div>
            )}

            {error ? (
              <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-opacity disabled:opacity-60"
            >
              {saving ? "保存中..." : "保存する"}
            </button>
          </div>
        </div>
      </div>

      {catalogOpen ? (
        <RemoteCatalogSheet
          onClose={() => setCatalogOpen(false)}
          registered={registered}
          onConfirm={handleCatalogConfirm}
        />
      ) : null}
    </>
  );
}
