import { describe, expect, it } from "vitest";
import {
  commitReminderDraft,
  commitThresholdDraft,
  parseNumberDraft,
  thresholdDraftKey,
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
