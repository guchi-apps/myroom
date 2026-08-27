"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DASHBOARD_SECTION_LABELS,
  REMOTE_CARD_KEY,
} from "@/lib/dashboard-sections";
import {
  getOrderedLifeCards,
  moveLifeCardOrderItem,
  reorderLifeCards,
} from "@/lib/life-card-order";
import { isHiddenKeyVisible } from "@/lib/visible-devices";
import { cn } from "@/lib/utils";

interface LifeSettingsSheetProps {
  open: boolean;
  /** `lib/life-card-order.ts` のキー配列。正規化はこの中で行う */
  order: readonly string[];
  hiddenKeys: Set<string>;
  /** 「電気の操作」の行に出す説明。何件出ているかを開く前に伝える */
  remoteSummary: string;
  onClose: () => void;
  onOrderChange: (order: string[]) => void;
  onVisibilityChange: (key: string, visible: boolean) => void;
  onEditRemoteButtons: () => void;
}

/**
 * 「暮らし」の設定シート（#283）。
 *
 * 以前は `/devices`（いまの環境の設定）の中に暮らしの表示・非表示が同居しており、
 * 1つの画面にセンサーの設定と混ざっていた。**入口を暮らしの見出しへ移し**、
 * 並び順もここで変えられるようにしている。`/devices` 側からは暮らしの節ごと外した
 * （同じ設定を2か所に置くと片方が古くなる）。
 *
 * 並べ替えの操作は `/devices` と揃える。PCは左のグリップをドラッグ、スマホは上下の矢印。
 * 出し方（スマホは下から、PCは中央）は `app-settings-sheet.tsx` と揃える。
 */
export function LifeSettingsSheet({
  open,
  order,
  hiddenKeys,
  remoteSummary,
  onClose,
  onOrderChange,
  onVisibilityChange,
  onEditRemoteButtons,
}: LifeSettingsSheetProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  if (!open) return null;

  const cards = getOrderedLifeCards(order);
  const keys = cards.map((card) => card.key);

  const handleMove = (index: number, direction: -1 | 1) => {
    onOrderChange(moveLifeCardOrderItem(keys, index, direction));
  };

  const handleDrop = (index: number) => (event: React.DragEvent) => {
    event.preventDefault();
    const fromIndex = dragIndex ?? Number(event.dataTransfer.getData("text/plain"));
    setDragIndex(null);
    setDragOverIndex(null);
    if (!Number.isFinite(fromIndex)) return;
    onOrderChange(reorderLifeCards(keys, fromIndex, index));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${DASHBOARD_SECTION_LABELS.life}の設定`}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-[20px] bg-card shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b px-5 py-4">
          <h2 className="text-lg font-bold">
            {DASHBOARD_SECTION_LABELS.life}の設定
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full hover:bg-accent"
            aria-label="閉じる"
          >
            <X className="size-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-3.5">
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
            カードの並び順と、ダッシュボードに出すかどうかを変更できます。
            <span className="sm:hidden">矢印ボタンで並べ替えてください。</span>
            <span className="hidden sm:inline">
              左のグリップをドラッグして並べ替えてください。
            </span>
          </p>

          <div className="flex flex-col gap-2">
            {cards.map((card, index) => {
              const visible = isHiddenKeyVisible(hiddenKeys, card.key);
              const canMoveUp = index > 0;
              const canMoveDown = index < cards.length - 1;

              return (
                <div
                  key={card.key}
                  className={cn(
                    "flex items-center gap-2 rounded-[15px] border bg-background px-2.5 py-2.5 transition-colors",
                    !visible && "opacity-50",
                    dragOverIndex === index &&
                      dragIndex !== index &&
                      "border-foreground/30 bg-accent/40"
                  )}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDragOverIndex(index);
                  }}
                  onDrop={handleDrop(index)}
                >
                  {/* スマホは矢印、PCはグリップ。同時には出さない（/devices と同じ） */}
                  <div className="flex shrink-0 flex-col sm:hidden">
                    <button
                      type="button"
                      onClick={() => handleMove(index, -1)}
                      disabled={!canMoveUp}
                      className={cn(
                        "flex h-7 w-8 items-center justify-center rounded-lg transition-colors",
                        canMoveUp
                          ? "text-muted-foreground active:bg-accent active:text-foreground"
                          : "text-muted-foreground/30"
                      )}
                      aria-label={`${card.label}を上へ`}
                    >
                      <ArrowUp className="size-4" strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMove(index, 1)}
                      disabled={!canMoveDown}
                      className={cn(
                        "flex h-7 w-8 items-center justify-center rounded-lg transition-colors",
                        canMoveDown
                          ? "text-muted-foreground active:bg-accent active:text-foreground"
                          : "text-muted-foreground/30"
                      )}
                      aria-label={`${card.label}を下へ`}
                    >
                      <ArrowDown className="size-4" strokeWidth={2} />
                    </button>
                  </div>

                  <div
                    draggable
                    onDragStart={(event) => {
                      setDragIndex(index);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(index));
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    className="hidden shrink-0 cursor-grab items-center text-muted-foreground active:cursor-grabbing sm:flex"
                    aria-hidden
                  >
                    <GripVertical className="size-[18px]" strokeWidth={1.75} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-bold">
                      {card.accentVar ? (
                        <span
                          className="h-3.5 w-[3px] shrink-0 rounded-sm"
                          style={{ backgroundColor: `var(${card.accentVar})` }}
                        />
                      ) : null}
                      {card.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      {card.key === REMOTE_CARD_KEY
                        ? remoteSummary
                        : visible
                          ? "ダッシュボードに表示中"
                          : "非表示。ダッシュボードには出ません"}
                    </p>
                  </div>

                  {card.key === REMOTE_CARD_KEY ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 rounded-xl px-2.5 text-[11.5px]"
                      onClick={onEditRemoteButtons}
                      aria-label="電気の操作のボタンを編集"
                    >
                      <Pencil className="size-3.5" strokeWidth={1.75} />
                      編集
                    </Button>
                  ) : null}

                  <button
                    type="button"
                    role="switch"
                    aria-checked={visible}
                    onClick={() => onVisibilityChange(card.key, !visible)}
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full transition-colors",
                      visible
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    )}
                    aria-label={
                      visible
                        ? `${card.label}をダッシュボードから隠す`
                        : `${card.label}をダッシュボードに表示する`
                    }
                  >
                    {visible ? (
                      <Eye className="size-[18px]" strokeWidth={1.75} />
                    ) : (
                      <EyeOff className="size-[18px]" strokeWidth={1.75} />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="border-t px-5 py-4">
          <Button
            className="h-11 w-full rounded-xl bg-foreground text-background hover:bg-foreground/90"
            onClick={onClose}
          >
            完了
          </Button>
        </div>
      </div>
    </div>
  );
}
