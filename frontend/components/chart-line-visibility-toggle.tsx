"use client";

import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ChartLineVisibilityToggleProps {
  visible: boolean;
  onChange: (visible: boolean) => void;
  id?: string;
  label?: string;
  description?: string;
  /** 目のボタンの左へ置く操作。「電気の操作」の編集ボタンが使う（#260） */
  action?: ReactNode;
}

export function ChartLineVisibilityToggle({
  visible,
  onChange,
  id = "chart-line-visible",
  label = "グラフに表示",
  description = "グラフの凡例や設定での切り替えは次回表示時も保持されます",
  action,
}: ChartLineVisibilityToggleProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-background/60 px-3 py-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={visible}
        onClick={() => onChange(!visible)}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors",
          visible
            ? "bg-foreground text-background"
            : "bg-muted text-muted-foreground hover:bg-accent"
        )}
        aria-label={visible ? "グラフに表示中" : "グラフに非表示"}
      >
        {visible ? (
          <Eye className="size-5" strokeWidth={1.75} />
        ) : (
          <EyeOff className="size-5" strokeWidth={1.75} />
        )}
      </button>
    </div>
  );
}
