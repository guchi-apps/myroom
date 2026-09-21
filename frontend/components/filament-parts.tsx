"use client";

import { LEVEL_BAR_CLASS, type FilamentSpool } from "@/lib/filament";
import { cn } from "@/lib/utils";

export function SpoolSwatch({
  color,
  className,
}: {
  color: string | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block size-[22px] shrink-0 rounded-full",
        color
          ? "ring-1 ring-inset ring-black/20 dark:ring-white/30"
          : "border-[1.5px] border-dashed border-border",
        className
      )}
      style={color ? { backgroundColor: color } : undefined}
    />
  );
}

export function LevelBar({ spool, label }: { spool: FilamentSpool; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={spool.percent}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn("h-full rounded-full", LEVEL_BAR_CLASS[spool.level])}
        style={{ width: `${spool.percent}%` }}
      />
    </div>
  );
}
