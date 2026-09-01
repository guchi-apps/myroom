"use client";

import type { ReactNode } from "react";

/**
 * 消費電力の詳細シートで使う読み込み表示（#329）。
 *
 * 目的は「実データと同じ骨格・ほぼ同じ高さを占めること」。3本線だけの簡素な
 * スケルトンにすると、シートの高さは中身で決まるため一度画面の下端まで縮み、
 * データ到着でまた最大高まで戻る。この上下動が「ちらつき」の正体なので、
 * タイル・棒グラフ・一覧の枠を先に置いて高さを動かさないようにする。
 */

/** 棒の高さ（%）。SSRとクライアントで一致させたいので乱数は使わず、式で散らす */
function skeletonBarHeight(index: number): number {
  return 38 + ((index * 29) % 47);
}

/**
 * 読み込み表示の外枠。
 *
 * 点滅（`animate-pulse`）は内側の要素に付ける。外側は`skeleton-delayed`が
 * `animation`を使うため、同じ要素に両方置くと片方が上書きされる。
 */
export function EnergySkeletonFrame({
  className = "gap-4",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="skeleton-delayed">
      <div className={`flex animate-pulse flex-col ${className}`}>{children}</div>
    </div>
  );
}

/** 「今月」「先月同日まで」「先月」のタイル3枚ぶん */
export function EnergyTilesSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {[0, 1, 2].map((index) => (
        <div key={index} className="h-[88px] rounded-2xl bg-muted" />
      ))}
    </div>
  );
}

/** 棒グラフ（高さ110px）と、その下の目盛り行ぶん */
export function EnergyBarChartSkeleton({ bars = 26 }: { bars?: number }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-[110px] items-end gap-[3px]">
        {Array.from({ length: bars }, (_, index) => (
          <div
            key={index}
            className="min-w-0 flex-1 rounded-[1.5px] bg-muted"
            style={{ height: `${skeletonBarHeight(index)}%` }}
          />
        ))}
      </div>
      {/* 目盛り行。高さは実際の文字（text-[10.5px]）の行送りに合わせる */}
      <div className="flex items-center justify-between border-t pt-1.5">
        <span className="h-4 w-10 rounded bg-muted" />
        <span className="h-4 w-28 rounded bg-muted" />
        <span className="h-4 w-10 rounded bg-muted" />
      </div>
    </div>
  );
}

/**
 * 日別・時間ごとの一覧ぶん。
 *
 * 行の高さ（`h-[19px]`）は実際の行（`text-[13px]`）に合わせてある。
 */
export function EnergyListSkeleton({
  rows,
  labelWidth = "w-[68px]",
  trailing = true,
}: {
  rows: number;
  /** 左端の見出し（日付・時刻）の幅。実際の一覧に合わせる */
  labelWidth?: string;
  /** 右端の金額列を出すか。時間ごとの一覧には無い */
  trailing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* 見出し行。高さは実際の文字（text-[11.5px]）の行送りに合わせる */}
      <div className="flex items-center justify-between">
        <span className="h-4 w-32 rounded bg-muted" />
        <span className="h-4 w-16 rounded bg-muted" />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-[19px] items-center gap-2.5">
          <span className={`${labelWidth} h-3 shrink-0 rounded bg-muted`} />
          <span className="h-1.5 min-w-0 flex-1 rounded-full bg-muted" />
          <span className="h-3 w-[62px] shrink-0 rounded bg-muted" />
          {trailing && <span className="h-3 w-12 shrink-0 rounded bg-muted" />}
        </div>
      ))}
    </div>
  );
}
