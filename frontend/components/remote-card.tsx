"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Lightbulb, Loader2, TriangleAlert, X } from "lucide-react";
import { sendRemoteButton } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import {
  formatRemoteErrorMessage,
  formatRemoteSentMessage,
  REMOTE_SENT_MESSAGE_MS,
  visibleRemoteGroups,
  type RemoteButtons,
  type RemoteFeedback,
} from "@/lib/remote";
import { cn } from "@/lib/utils";

interface RemoteCardProps {
  buttons: RemoteButtons | null;
  loading: boolean;
  error: boolean;
}

function RemoteMessage({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/**
 * Nature Remo に登録済みの操作を押すためのカード。
 *
 * **トグルにはしない。** 赤外線は片方向で、照明が実際に点いたかは返ってこない。
 * 状態を持つと画面と部屋の実態がずれるため、物理リモコンと同じ「押すだけのボタン」に
 * 揃えている（#106）。出せるのは「Nature Remo が送信を受け付けた」ところまで。
 */
export function RemoteCard({ buttons, loading, error }: RemoteCardProps) {
  const [feedback, setFeedback] = useState<RemoteFeedback | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  const press = useCallback(async (buttonId: string) => {
    if (clearTimer.current) {
      clearTimeout(clearTimer.current);
      clearTimer.current = null;
    }
    setFeedback({ buttonId, status: "sending" });
    try {
      const result = await sendRemoteButton(buttonId);
      setFeedback({
        buttonId,
        status: "sent",
        message: formatRemoteSentMessage(result),
      });
      // 成功の表示は数秒で消し、カードを元の説明文へ戻す
      clearTimer.current = setTimeout(() => {
        setFeedback(null);
        clearTimer.current = null;
      }, REMOTE_SENT_MESSAGE_MS);
    } catch (err) {
      if (err instanceof AuthError) {
        // 401 の時点でサインアウト済み。すぐログイン画面へ切り替わるので何も出さない
        setFeedback(null);
        return;
      }
      setFeedback({
        buttonId,
        status: "failed",
        message: formatRemoteErrorMessage(
          err instanceof Error ? err.message : undefined
        ),
      });
    }
  }, []);

  const sending = feedback?.status === "sending";
  // オフライン表示に切り替わったときも一覧は届かない。読み込めなかった扱いでまとめる
  const unavailable = !loading && (error || buttons == null);

  // 設定画面で隠したボタンは出さない。1つも残らないグループは見出しごと落とす（#260）
  const groups = useMemo(() => visibleRemoteGroups(buttons), [buttons]);
  const allHidden = (buttons?.configured ?? false) && groups.length === 0;

  return (
    <div className="device-card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="device-card-title flex min-w-0 flex-1 items-center gap-2">
          <Lightbulb
            className="size-5 shrink-0"
            strokeWidth={1.75}
            style={{ color: "var(--remote-color)" }}
          />
          電気の操作
        </p>
      </div>

      {loading && <RemoteMessage>読み込み中...</RemoteMessage>}

      {unavailable && (
        <p className="text-sm text-destructive">操作できるボタンを読み込めませんでした</p>
      )}

      {!loading && !unavailable && !buttons?.configured && (
        <RemoteMessage>
          まだボタンがありません。設定の「ダッシュボードの表示」→「電気の操作」の編集から、
          Nature Remo に登録済みの操作を選べます。
        </RemoteMessage>
      )}

      {allHidden && (
        <RemoteMessage>
          出すボタンが1つも選ばれていません（「ダッシュボードの表示」から選べます）
        </RemoteMessage>
      )}

      {!loading && !unavailable && buttons?.configured && !allHidden && (
        <>
          <div className="flex flex-col gap-3.5">
            {groups.map((group) => (
              <div key={group.id} className="flex flex-col gap-2">
                <p className="ml-0.5 text-[11px] tracking-wider text-muted-foreground">
                  {group.name}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {group.buttons.map((button) => {
                    const active = feedback?.buttonId === button.id;
                    const status = active && feedback ? feedback.status : null;
                    return (
                      <button
                        key={button.id}
                        type="button"
                        onClick={() => void press(button.id)}
                        disabled={sending}
                        className={cn(
                          "flex min-h-12 items-center justify-center gap-1.5 rounded-[14px] bg-secondary px-2 py-1.5 text-sm font-bold text-foreground transition-colors",
                          "hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                          status === "sending" && "cursor-progress opacity-55",
                          status === "sent" && "bg-primary/15",
                          status === "failed" && "bg-destructive/10 text-destructive",
                          sending && !active && "opacity-40"
                        )}
                      >
                        {status === "sending" && (
                          <Loader2 className="size-4 shrink-0 animate-spin" />
                        )}
                        {status === "sent" && <Check className="size-4 shrink-0" />}
                        {status === "failed" && <X className="size-4 shrink-0" />}
                        <span className="truncate">{button.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {feedback?.status === "sent" && (
            <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-primary/10 px-2.5 py-2 text-xs text-foreground">
              <Check className="size-4 shrink-0" />
              {feedback.message}
            </p>
          )}

          {feedback?.status === "failed" && (
            <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
              <TriangleAlert className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">{feedback.message}</span>
              <button
                type="button"
                onClick={() => void press(feedback.buttonId)}
                className="shrink-0 font-bold underline underline-offset-2"
              >
                もう一度
              </button>
            </div>
          )}

          {!feedback && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              押すと赤外線を送ります。今ついているかどうかは表示しません。
            </p>
          )}
        </>
      )}
    </div>
  );
}
