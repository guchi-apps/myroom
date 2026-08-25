import { cn } from "@/lib/utils";

/**
 * アプリアイコン。ホーム画面のアイコンをタップしてから開くまでの絵をつなげるため、
 * 起動直後の画面はこれを出す。
 *
 * **絵柄を持たず、生成済みの `public/icon-192.png` をそのまま表示する。**
 * アイコンの正は `assets/app-icon-source.svg`（CLAUDE.md「アプリアイコン」）で、
 * ここにSVGを書き写すと描き直したときの更新漏れが増えるため。
 * タイルの背景色もPNGに含まれているので、ホーム画面のアイコンと必ず同じ見た目になる。
 */
export function AppBrandMark({ className }: { className?: string }) {
  return (
    // 表示サイズが固定のローカル画像で、`output: "export"`のため最適化も効かない。
    // next/imageを挟むと`/_next/image?url=...`のURLになるだけなので素の<img>で出す
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icon-192.png"
      alt="MyRoom"
      width={88}
      height={88}
      className={cn("size-[88px] rounded-[26px]", className)}
    />
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
