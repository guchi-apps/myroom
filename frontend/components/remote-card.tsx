"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AirVent,
  Check,
  ChevronRight,
  Lightbulb,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
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

/**
 * カードから開けるエアコン（#268）。
 *
 * **Nature Remo のボタンではない。** 白くまくん（AirCloud Home）の操作パネルを
 * 開くだけの入口で、押しても赤外線は飛ばない。センサーのエアコンカードを探さずに
 * 「暮らし」から操作できるようにするためのもの。
 */
export interface RemoteAirconEntry {
  /** 表示名。エアコンカードの見出しと同じ */
  title: string;
  /**
   * 右に添える運転状態（`buildAirconStatusPill()` の戻り値）。
   * 設定温度を非表示にしているときは `null` で渡され、状態を出さない。
   */
  status: { label: string; color: string | null } | null;
  onOpen: () => void;
}

/**
 * エアコンの行の見出し。
 *
 * 表示名を付けていないエアコンは `エアコン` という名前で出るため
 * （`myroom-dashboard.tsx` の `airconChartTitle`）、見出しと行が同じ言葉になる。
 * そのときは見出しを省く。
 */
const AIRCON_GROUP_NAME = "エアコン";

interface RemoteCardProps {
  buttons: RemoteButtons | null;
  loading: boolean;
  error: boolean;
  /** 操作できないとき（ログイン情報が未設定・オフライン）は `null` で入口ごと出さない */
  aircon?: RemoteAirconEntry | null;
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
 *
 * **エアコンの行だけは例外で、押しても赤外線は飛ばない**（#268）。白くまくん
 * （AirCloud Home）は雲を経由して現在の運転状態を読めるため、状態を出して操作パネルを
 * 開く入口にしている。ボタンと同じ形にすると押した結果を取り違えるので、区切り線を
 * はさんだ全幅の行にして矢印を添える。
 */
export function RemoteCard({ buttons, loading, error, aircon }: RemoteCardProps) {
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
  // 赤外線のボタンが並ぶか。エアコンの入口はこれとは別に出す（1つも無くても出す。#268）
  const hasGroups =
    !loading && !unavailable && (buttons?.configured ?? false) && !allHidden;

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

      {hasGroups && (
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
      )}

      {aircon && (
        <div
          className={cn(
            "flex flex-col gap-2",
            // 赤外線のボタンとは押したときの結果が違うので、区切り線をはさむ
            hasGroups ? "mt-3.5 border-t pt-3.5" : "mt-3"
          )}
        >
          {aircon.title.trim() !== AIRCON_GROUP_NAME && (
            <p className="ml-0.5 text-[11px] tracking-wider text-muted-foreground">
              {AIRCON_GROUP_NAME}
            </p>
          )}
          <button
            type="button"
            onClick={aircon.onOpen}
            className={cn(
              "flex min-h-12 items-center gap-2.5 rounded-[14px] bg-secondary px-3 py-2 text-left transition-colors",
              "hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            )}
          >
            <AirVent
              className="size-[19px] shrink-0"
              strokeWidth={1.8}
              style={{ color: aircon.status?.color ?? "var(--muted-foreground)" }}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">
              {aircon.title}
            </span>
            {aircon.status ? (
              aircon.status.color ? (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums"
                  style={{
                    color: aircon.status.color,
                    backgroundColor: `${aircon.status.color}24`,
                  }}
                >
                  {aircon.status.label}
                </span>
              ) : (
                <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                  {aircon.status.label}
                </span>
              )
            ) : null}
            <ChevronRight
              className="size-[18px] shrink-0 text-muted-foreground/70"
              strokeWidth={1.75}
            />
          </button>
        </div>
      )}

      {hasGroups && (
        <>
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
              {aircon
                ? "ボタンを押すと赤外線を送ります。今ついているかどうかは表示しません。エアコンは押すと操作パネルが開きます。"
                : "押すと赤外線を送ります。今ついているかどうかは表示しません。"}
            </p>
          )}
        </>
      )}
    </div>
  );
}
