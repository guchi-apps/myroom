"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Lightbulb, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { fetchRemoteCatalog, refreshRemoteCatalog } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import {
  formatCatalogFetchedAt,
  hasSelectableRemoteButtons,
  type RemoteCatalog,
} from "@/lib/remote";
import { cn } from "@/lib/utils";

interface RemoteCatalogSheetProps {
  onClose: () => void;
  /** すでに登録済みのボタンID。はじめからチェックが付いた状態で開く */
  registered: ReadonlySet<string>;
  /** 決定したときに、選択したIDと、その時点の一覧を返す */
  onConfirm: (selected: Set<string>, catalog: RemoteCatalog) => void;
}

const EMPTY_CATALOG: RemoteCatalog = { fetched_at: "", devices: [] };

/**
 * Nature Remo に登録済みの操作から、ボタンにするものを選ぶシート（#262）。
 *
 * **開いただけでは Nature Remo を叩かない。** 出すのは最後に取得した控えで、
 * 取り直すのは「読み込み直す」を押したときだけ。Cloud API の上限が 30回/5分
 * しかないため、開くたびに問い合わせる作りにはできない。
 *
 * ここでは保存しない。決定すると呼び出し側の編集内容に反映されるだけで、
 * 実際に書き込むのは元のシートの「保存する」。保存の口を2つ持つと、
 * 片方だけ押して閉じたときに画面と保存内容が食い違う。
 */
export function RemoteCatalogSheet({
  onClose,
  registered,
  onConfirm,
}: RemoteCatalogSheetProps) {
  const [catalog, setCatalog] = useState<RemoteCatalog>(EMPTY_CATALOG);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(registered));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const loaded = await fetchRemoteCatalog();
        if (alive) setCatalog(loaded);
      } catch {
        // 控えが読めなくても「読み込み直す」は押せる。ここでは何も出さない
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      setCatalog(await refreshRemoteCatalog());
    } catch (err) {
      if (err instanceof AuthError) return;
      setError(err instanceof Error ? err.message : "読み込めませんでした");
    } finally {
      setRefreshing(false);
    }
  }, []);

  const toggle = (buttonId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(buttonId)) next.delete(buttonId);
      else next.add(buttonId);
      return next;
    });
  };

  const fetchedAt = formatCatalogFetchedAt(catalog.fetched_at);
  const selectable = hasSelectableRemoteButtons(catalog);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-[20px] bg-card shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Lightbulb
              className="size-5 shrink-0"
              strokeWidth={1.75}
              style={{ color: "var(--remote-color)" }}
            />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold">Nature Remo から選ぶ</h2>
              <p className="truncate text-sm text-muted-foreground">
                登録済みの操作から、ボタンにするものを選びます
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
          <div className="flex items-center justify-between gap-2 rounded-[14px] bg-secondary px-3 py-2">
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {fetchedAt ? (
                <>
                  最終取得 <span className="font-semibold text-foreground">{fetchedAt}</span>
                </>
              ) : (
                "まだ読み込んでいません"
              )}
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-card px-2.5 text-xs font-bold transition-opacity disabled:opacity-60"
            >
              {refreshing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" strokeWidth={2} />
              )}
              {fetchedAt ? "読み込み直す" : "読み込む"}
            </button>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            読み込むときだけ Nature Remo に問い合わせます（30回/5分の上限があります）。
          </p>

          {error ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
            </p>
          ) : null}

          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">読み込み中...</p>
          ) : null}

          {!loading && catalog.devices.length === 0 ? (
            <p className="py-6 text-center text-sm leading-relaxed text-muted-foreground">
              Nature Remo に登録済みの機器がまだ分かりません。
              <br />
              上の「読み込む」を押してください。
            </p>
          ) : null}

          {!loading && catalog.devices.length > 0 ? (
            <div className="mt-4 flex flex-col gap-4">
              {catalog.devices.map((device) => (
                <div key={device.id} className="flex flex-col gap-1.5">
                  <p className="ml-0.5 flex items-baseline gap-2 text-[11px] tracking-wider text-muted-foreground">
                    <span className="text-[12.5px] font-bold tracking-normal text-foreground">
                      {device.name}
                    </span>
                    {device.type}
                  </p>

                  {device.note ? (
                    <p className="rounded-[14px] border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                      {device.note}
                    </p>
                  ) : null}

                  {device.buttons.map((button) => {
                    const on = selected.has(button.id);
                    return (
                      <button
                        key={button.id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggle(button.id)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-[14px] border px-3 py-2 text-left transition-colors",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          on ? "border-transparent bg-primary/10" : "hover:bg-accent"
                        )}
                        style={on ? { borderColor: "var(--remote-color)" } : undefined}
                      >
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px]",
                            on
                              ? "border-foreground bg-foreground text-background"
                              : "border-muted-foreground"
                          )}
                        >
                          {on ? <Check className="size-3" strokeWidth={3} /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {button.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}

              <p className="text-xs leading-relaxed text-muted-foreground">
                チェックを外すと登録から消えます。付けた名前も一緒に消えます。
              </p>
            </div>
          ) : null}

          {selectable ? (
            <button
              type="button"
              onClick={() => onConfirm(new Set(selected), catalog)}
              className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground"
            >
              {selected.size}件を登録する
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
