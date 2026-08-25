import { cn } from "@/lib/utils";

/**
 * アプリアイコン（`assets/app-icon-source.svg`）と同じ絵柄。
 * ホーム画面のアイコンをタップしてから開くまでの絵をつなげるため、起動直後の画面はこれを使う。
 * 背景のタイル色はテーマで切り替えたいので、SVG側の `<rect>` は持たずに外側のdivで塗る。
 */
export function AppBrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex size-[88px] items-center justify-center overflow-hidden rounded-[26px] bg-[#e9f9f0] dark:bg-[#14301f]",
        className
      )}
    >
      <svg viewBox="0 0 512 512" className="size-full" role="img" aria-label="MyRoom">
        <g transform="translate(34,29.8) scale(5.55)">
          <ellipse cx="40" cy="48" rx="28" ry="26" fill="#2ecc71" />
          <ellipse cx="40" cy="44" rx="22" ry="20" fill="#48dd88" />
          <circle cx="30" cy="40" r="3.4" fill="#ffffff" />
          <circle cx="50" cy="40" r="3.4" fill="#ffffff" />
          <path
            d="M32 50 Q40 56.5 48 50"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <line
            x1="40"
            y1="17"
            x2="40"
            y2="26"
            stroke="#2ecc71"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <polygon points="40,7.5 45.4,19 34.6,19" fill="#f1c40f" />
        </g>
      </svg>
    </div>
  );
}

/**
 * ダッシュボードへ入る前の画面（読み込み中・ログイン）の共通レイアウト。
 * アイコン・アプリ名・説明文の位置を固定し、`children`のブロックだけを差し替えることで、
 * 読み込み中からログインへ切り替わっても要素が飛び跳ねないようにする（#250）。
 */
export function AppEntryScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <AppBrandMark />
      <p className="mt-[18px] text-[26px] font-bold leading-tight tracking-wide text-foreground">
        MyRoom
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">お部屋の状態をモニタリング</p>
      <div className="mt-[34px] flex min-h-[96px] w-full flex-col items-center gap-3">
        {children}
      </div>
    </div>
  );
}
