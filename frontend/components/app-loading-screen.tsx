import { AppEntryScreen } from "@/components/app-entry-screen";

/**
 * 起動中の読み込み画面。ログイン済みかどうかが分かるまでの区間で出す。
 * ここでログイン画面を出してしまうと、ログイン済みでも一瞬「ログインしてください」が見える（#250）。
 */
export function AppLoadingScreen({ label = "読み込み中" }: { label?: string }) {
  return (
    <AppEntryScreen>
      <div
        className="h-1 w-44 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
      >
        <div className="app-progress-sweep h-full w-[42%] rounded-full bg-[#2ecc71]" />
      </div>
      <p className="text-[13px] tracking-wide text-muted-foreground">{label}</p>
    </AppEntryScreen>
  );
}
