import type { ComingSoonCardDefinition } from "@/lib/dashboard-sections";

/**
 * まだ作っていない機能の案内カード。押しても何も起きない。
 * 実装が済んだら、この位置に本物のカードが入れ替わりで並ぶ。
 */
export function ComingSoonCard({ card }: { card: ComingSoonCardDefinition }) {
  return (
    <div className="flex min-h-[74px] items-center gap-3 rounded-[18px] border border-dashed border-border bg-transparent px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-bold text-muted-foreground">{card.label}</span>
        <span className="text-xs leading-snug text-muted-foreground/80">
          {card.description}
        </span>
      </div>
      <span className="ml-auto shrink-0 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
        準備中
      </span>
    </div>
  );
}
