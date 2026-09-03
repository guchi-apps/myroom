"use client";

import { useCallback, useMemo, useState } from "react";
import {
  buildPanelChartLineVisibility,
  type ChartLineVisibilityOverrides,
  type ChartLineVisibilitySettings,
} from "@/lib/chart-line-visibility";

interface PanelLineVisibility {
  /** `EnvironmentChart` へ渡す表示状態 */
  lineVisibility: ChartLineVisibilitySettings;
  /** 凡例の目のアイコンから呼ぶハンドラ */
  handleLineVisibilityChange: (key: string, visible: boolean) => void;
}

/**
 * 詳細パネルの中だけで効くグラフ線の表示切り替え（#357）。
 *
 * `forcedVisibleKeys`（そのパネルが必ず出すと決めているキー）は、パネルを開いた時点では
 * グローバル設定に関わらず表示になる（#351）。パネル内で目のアイコンを押した結果は
 * **パネルを開いているあいだだけ**覚え、グローバル設定（推移グラフの凡例・`/devices`）へは
 * 書かない。書いてしまうと、開き直すたびに強制表示へ戻るのに、ダッシュボードのグラフからは
 * 線が消えたままになるため。
 *
 * `forcedVisibleKeys` に含まれないキー（他デバイスの線など）は、これまでどおり
 * `onGlobalChange` へ渡してグローバル設定を書き換える。
 *
 * パネルは開いているあいだだけマウントする方針なので、閉じれば切り替えは初期状態へ戻る。
 */
export function usePanelLineVisibility(
  base: ChartLineVisibilitySettings,
  forcedVisibleKeys: readonly string[],
  onGlobalChange?: (key: string, visible: boolean) => void
): PanelLineVisibility {
  const [panelOverrides, setPanelOverrides] = useState<ChartLineVisibilityOverrides>({});

  const lineVisibility = useMemo(
    () => buildPanelChartLineVisibility(base, forcedVisibleKeys, panelOverrides),
    [base, forcedVisibleKeys, panelOverrides]
  );

  const handleLineVisibilityChange = useCallback(
    (key: string, visible: boolean) => {
      if (forcedVisibleKeys.includes(key)) {
        setPanelOverrides((prev) => ({ ...prev, [key]: visible }));
        return;
      }
      onGlobalChange?.(key, visible);
    },
    [forcedVisibleKeys, onGlobalChange]
  );

  return { lineVisibility, handleLineVisibilityChange };
}
