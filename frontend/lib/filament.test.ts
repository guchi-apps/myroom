import { describe, expect, it } from "vitest";
import {
  buildCalcRows,
  buildHistory,
  describeBasis,
  formatGrams,
  formatLevelHint,
  formatStockSummary,
  formatUsageGrams,
  getActiveSpool,
  parseGramsInput,
  splitSpools,
} from "@/lib/filament";
import { makePayload, makeSpool } from "@/lib/filament-fixtures";

describe("グラム数の整形", () => {
  it("残量は整数、使用量は小数を残す", () => {
    expect(formatGrams(390.6)).toBe("391");
    expect(formatUsageGrams(42)).toBe("42");
    expect(formatUsageGrams(26.4)).toBe("26.4");
  });
});

describe("parseGramsInput", () => {
  it("全角・カンマ・末尾のgを読む", () => {
    expect(parseGramsInput("６１１", 0, 12000)).toBe(611);
    expect(parseGramsInput("1,011 g", 0, 12000)).toBe(1011);
    expect(parseGramsInput("26.44", 0.1, 5000)).toBe(26.4);
  });

  it("空欄・数値以外・範囲外は null（0が保存されない）", () => {
    expect(parseGramsInput("", 0, 100)).toBeNull();
    expect(parseGramsInput("  ", 0, 100)).toBeNull();
    expect(parseGramsInput("abc", 0, 100)).toBeNull();
    expect(parseGramsInput("-", 0, 100)).toBeNull();
    expect(parseGramsInput("101", 0, 100)).toBeNull();
    expect(parseGramsInput("0", 0.1, 100)).toBeNull();
  });
});

describe("残量の内訳", () => {
  it("計量が基準のときは 全体 − 空スプール − 使用量 の順に並ぶ", () => {
    const rows = buildCalcRows(makeSpool());
    expect(rows.map((row) => row.value)).toEqual(["611 g", "152 g", "459 g", "68 g", "391 g"]);
    expect(rows[0].label).toContain("9/14");
    expect(rows.at(-1)?.total).toBe(true);
  });

  it("計量が無いときは初期フィラメント量から始める", () => {
    const rows = buildCalcRows(
      makeSpool({
        base: { kind: "initial", gross_g: null, net_g: 1000, date: null },
        remaining_g: 974,
        percent: 97,
        used_since_g: 26,
        used_since_count: 1,
      })
    );
    expect(rows.map((row) => row.value)).toEqual(["1000 g", "26 g", "974 g"]);
    expect(rows[0].label).toBe("初期フィラメント量");
  });

  it("使用量が無ければ引く行を出さない", () => {
    const rows = buildCalcRows(makeSpool({ used_since_count: 0, used_since_g: 0 }));
    expect(rows).toHaveLength(4);
  });
});

describe("describeBasis", () => {
  it("計量の日と、それ以降の使用量を言う", () => {
    expect(describeBasis(makeSpool())).toBe("9/14に計量、以降2回で68g");
  });

  it("計量も使用量も無ければ未使用", () => {
    expect(
      describeBasis(
        makeSpool({
          base: { kind: "initial", gross_g: null, net_g: 1000, date: null },
          used_since_count: 0,
          used_since_g: 0,
        })
      )
    ).toBe("未使用");
  });
});

describe("履歴", () => {
  it("使用量と計量を日付の新しい順に混ぜる", () => {
    const rows = buildHistory(makeSpool());
    expect(rows.map((row) => row.key)).toEqual(["u:u2", "u:u1", "w:w1", "u:u0"]);
    expect(rows[2].label).toBe("計量（全体 611 g）");
    expect(rows[2].value).toBe("459 g");
  });

  it("計量に含まれている使用量は「反映済み」の印を付ける", () => {
    const rows = buildHistory(makeSpool());
    expect(rows.find((row) => row.id === "u0")?.settled).toBe(true);
    expect(rows.find((row) => row.id === "u2")?.settled).toBe(false);
  });

  it("件数の上限で切る", () => {
    expect(buildHistory(makeSpool(), 2)).toHaveLength(2);
  });
});

describe("在庫の集計", () => {
  const archived = makeSpool({ id: "s2", archived: true, active: false, remaining_g: 0, percent: 0, level: "empty" });

  it("使い切りは在庫の本数に数えず、括弧で添える", () => {
    expect(formatStockSummary(makePayload([makeSpool(), archived]))).toBe("在庫 1本（使い切り1本）");
    expect(formatStockSummary(makePayload([makeSpool()]))).toBe("在庫 1本");
  });

  it("使用中のスプールを引く。無ければ null", () => {
    const payload = makePayload([makeSpool(), archived]);
    expect(getActiveSpool(payload)?.id).toBe("s1");
    expect(getActiveSpool(makePayload([makeSpool({ active: false })]))).toBeNull();
    expect(getActiveSpool(null)).toBeNull();
  });

  it("splitSpools は使い切りを分ける", () => {
    const { inUse, archived: done } = splitSpools(makePayload([makeSpool(), archived]));
    expect(inUse.map((spool) => spool.id)).toEqual(["s1"]);
    expect(done.map((spool) => spool.id)).toEqual(["s2"]);
  });

  it("残りわずか・使い切りのときだけ注記を出す", () => {
    expect(formatLevelHint(makeSpool())).toBeNull();
    expect(formatLevelHint(makeSpool({ level: "low" }))).toBe("残りわずか");
    expect(formatLevelHint(makeSpool({ level: "empty" }))).toBe("使い切り");
  });
});
