import { describe, expect, it } from "vitest";
import {
  categoryHasTiming,
  commitReminderDraft,
  commitThresholdDraft,
  parseNumberDraft,
  thresholdDraftKey,
  toggleCategoryTiming,
} from "@/components/notification-settings-sheet";

const thresholds = {
  temperature: { min: 16, max: 30 },
  humidity: { min: 30, max: 70 },
};

describe("parseNumberDraft", () => {
  it("入力途中で確定できない文字列は null にする", () => {
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft("   ")).toBeNull();
    expect(parseNumberDraft("-")).toBeNull();
    expect(parseNumberDraft("1e")).toBeNull();
    expect(parseNumberDraft("18度")).toBeNull();
  });

  it("数値として読める文字列はそのまま数値にする", () => {
    expect(parseNumberDraft("18")).toBe(18);
    expect(parseNumberDraft("18.5")).toBe(18.5);
    expect(parseNumberDraft(" -3.5 ")).toBe(-3.5);
  });
});

describe("commitThresholdDraft", () => {
  it("空欄のまま離れても保存しない（元の値へ戻す）", () => {
    expect(commitThresholdDraft(thresholds, "temperature", "min", "")).toEqual({
      status: "unchanged",
    });
  });

  it("同じ値なら保存しない", () => {
    expect(commitThresholdDraft(thresholds, "temperature", "min", "16")).toEqual({
      status: "unchanged",
    });
  });

  it("指定した指標・境界だけを差し替える", () => {
    expect(commitThresholdDraft(thresholds, "temperature", "max", "27.5")).toEqual({
      status: "ok",
      value: {
        temperature: { min: 16, max: 27.5 },
        humidity: { min: 30, max: 70 },
      },
    });
  });

  it("小数第1位へ丸める（バックエンドの round(value, 1) に合わせる）", () => {
    const result = commitThresholdDraft(thresholds, "humidity", "min", "33.34");
    expect(result).toEqual({
      status: "ok",
      value: {
        temperature: { min: 16, max: 30 },
        humidity: { min: 33.3, max: 70 },
      },
    });
  });

  it("下限が上限以上になる入力は保存に出さず、理由を返す", () => {
    // 上限を「2」まで消した状態で確定すると、バックエンドは min >= max として
    // 既定値（16/30）へ落としてしまう。ここで弾いて値が飛ばないようにする
    const result = commitThresholdDraft(thresholds, "temperature", "max", "2");
    expect(result.status).toBe("invalid");
    expect(result).toMatchObject({ message: expect.stringContaining("室温") });
  });

  it("湿度でも同じように弾き、指標の名前を出す", () => {
    const result = commitThresholdDraft(thresholds, "humidity", "min", "70");
    expect(result).toMatchObject({ status: "invalid", message: expect.stringContaining("湿度") });
  });
});

describe("commitReminderDraft", () => {
  it("空欄・数字でない入力は保存しない", () => {
    expect(commitReminderDraft(60, "")).toEqual({ status: "unchanged" });
    expect(commitReminderDraft(60, "-")).toEqual({ status: "unchanged" });
  });

  it("バックエンドと同じ範囲（5〜1440分）へ丸める", () => {
    expect(commitReminderDraft(60, "1")).toEqual({ status: "ok", value: 5 });
    expect(commitReminderDraft(60, "5000")).toEqual({ status: "ok", value: 1440 });
    expect(commitReminderDraft(60, "90.6")).toEqual({ status: "ok", value: 91 });
  });

  it("丸めた結果が今の値と同じなら保存しない", () => {
    expect(commitReminderDraft(5, "1")).toEqual({ status: "unchanged" });
  });
});

describe("thresholdDraftKey", () => {
  it("指標と境界の組み合わせごとに別のキーになる", () => {
    expect(thresholdDraftKey("temperature", "min")).toBe("temperature.min");
    expect(thresholdDraftKey("humidity", "max")).toBe("humidity.max");
  });
});

describe("categoryHasTiming", () => {
  it("未指定の品目は前日のみ（既定動作を維持）", () => {
    expect(categoryHasTiming({}, "burnable", "before")).toBe(true);
    expect(categoryHasTiming({}, "burnable", "same_day")).toBe(false);
  });

  it("前日・当日の両方を選んでいる品目は両方 true", () => {
    const timing = { bulky: ["before", "same_day"] as ("before" | "same_day")[] };
    expect(categoryHasTiming(timing, "bulky", "before")).toBe(true);
    expect(categoryHasTiming(timing, "bulky", "same_day")).toBe(true);
  });

  it("両方外している品目はどちらも false", () => {
    const timing = { incombustible: [] as ("before" | "same_day")[] };
    expect(categoryHasTiming(timing, "incombustible", "before")).toBe(false);
    expect(categoryHasTiming(timing, "incombustible", "same_day")).toBe(false);
  });
});

describe("toggleCategoryTiming", () => {
  it("未指定（前日のみ）の品目に当日をONにすると、前日・当日の両方が残る", () => {
    const result = toggleCategoryTiming({}, "bulky", "same_day", true);
    expect(result.bulky).toEqual(["before", "same_day"]);
  });

  it("両方ONの品目から前日をOFFにすると、当日だけが残る", () => {
    const result = toggleCategoryTiming(
      { bulky: ["before", "same_day"] },
      "bulky",
      "before",
      false
    );
    expect(result.bulky).toEqual(["same_day"]);
  });

  it("前日のみの品目から前日をOFFにすると、空配列になる（通知しない）", () => {
    const result = toggleCategoryTiming({}, "burnable", "before", false);
    expect(result.burnable).toEqual([]);
  });

  it("他の品目の設定は変えない", () => {
    const result = toggleCategoryTiming(
      { recyclable: ["same_day"] },
      "burnable",
      "same_day",
      true
    );
    expect(result.recyclable).toEqual(["same_day"]);
    expect(result.burnable).toEqual(["before", "same_day"]);
  });
});
