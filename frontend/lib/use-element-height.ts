"use client";

import { useCallback, useState } from "react";

/**
 * 要素の高さ（px）を追い続ける。`position: fixed` にして文書の流れから外した要素と
 * 同じ高さの余白を置くために使う（#513 のダッシュボードのヘッダー）。
 *
 * 返す `ref` は callback ref で、付いた時点で ResizeObserver を張り、外れたら外す
 * （React 19 の ref のクリーンアップ）。effect を使わないので、描画のたびに張り直さない。
 * 測れるまでは `null` を返すので、呼び出し側は CSS の既定値で埋めておく
 * （静的書き出しのHTMLでは JS が走るまで測れない）。
 */
export function useElementHeight<T extends HTMLElement>(): [
  (node: T | null) => (() => void) | undefined,
  number | null,
] {
  const [height, setHeight] = useState<number | null>(null);

  const ref = useCallback((node: T | null) => {
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const update = () => setHeight(node.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, height];
}
