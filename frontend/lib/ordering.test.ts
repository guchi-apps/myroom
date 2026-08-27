import { describe, expect, it } from "vitest";
import { moveOrderItem, normalizeOrderKeys, reorderItems } from "@/lib/ordering";

describe("ordering", () => {
  it("保存が無ければ既定をそのまま返す", () => {
    expect(normalizeOrderKeys(null, ["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeOrderKeys([], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("既定に無いキーと重複を落とし、欠けたキーを末尾へ足す", () => {
    expect(normalizeOrderKeys(["c", "b", "b", "removed"], ["a", "b", "c"])).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("隣と入れ替え、端では動かさない", () => {
    expect(moveOrderItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveOrderItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveOrderItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("抜いて差し込む。範囲外は動かさない", () => {
    expect(reorderItems(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderItems(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(reorderItems(["a", "b", "c"], 0, 9)).toEqual(["a", "b", "c"]);
  });

  // 元の配列を書き換えない（React の state をそのまま渡すため）
  it("引数の配列は変えない", () => {
    const items = ["a", "b", "c"];
    moveOrderItem(items, 0, 1);
    reorderItems(items, 0, 2);
    expect(items).toEqual(["a", "b", "c"]);
  });
});
