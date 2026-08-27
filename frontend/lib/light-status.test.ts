import { describe, expect, it } from "vitest";
import {
  formatLightStatusDetail,
  formatLightThreshold,
  getLightThreshold,
  resolveDeviceLightStatus,
  resolveLightStatus,
} from "@/lib/light-status";
import type { LatestData } from "@/lib/types";

describe("getLightThreshold", () => {
  it("設定されているデバイスのしきい値を返す", () => {
    expect(getLightThreshold({ "1": 80 }, 1)).toBe(80);
  });

  it("設定の無いデバイスは null", () => {
    expect(getLightThreshold({ "1": 80 }, 2)).toBeNull();
    expect(getLightThreshold({}, 1)).toBeNull();
    expect(getLightThreshold(undefined, 1)).toBeNull();
  });

  it("0以下・数値でない値は判定しない扱いにする", () => {
    expect(getLightThreshold({ "1": 0 }, 1)).toBeNull();
    expect(getLightThreshold({ "1": -10 }, 1)).toBeNull();
    expect(getLightThreshold({ "1": Number.NaN }, 1)).toBeNull();
  });
});

describe("resolveLightStatus", () => {
  it("しきい値以上なら点灯", () => {
    expect(resolveLightStatus(312, 80)).toEqual({
      status: "on",
      illuminance: 312,
      threshold: 80,
    });
  });

  it("しきい値ちょうどは点灯に含める", () => {
    expect(resolveLightStatus(80, 80)?.status).toBe("on");
  });

  it("しきい値を下回れば消灯", () => {
    expect(resolveLightStatus(79.9, 80)?.status).toBe("off");
    expect(resolveLightStatus(0, 80)?.status).toBe("off");
  });

  it("照度が届いていなければ判定しない（消灯にはしない）", () => {
    expect(resolveLightStatus(null, 80)).toBeNull();
    expect(resolveLightStatus(undefined, 80)).toBeNull();
    expect(resolveLightStatus(Number.NaN, 80)).toBeNull();
  });

  it("しきい値が未設定なら判定しない", () => {
    expect(resolveLightStatus(312, null)).toBeNull();
    expect(resolveLightStatus(312, 0)).toBeNull();
  });
});

describe("resolveDeviceLightStatus", () => {
  const latest = { illuminance: 312 } as LatestData;

  it("最新データの照度としきい値から判定する", () => {
    expect(resolveDeviceLightStatus(latest, { "1": 80 }, 1)?.status).toBe("on");
  });

  it("最新データが無ければ判定しない", () => {
    expect(resolveDeviceLightStatus(null, { "1": 80 }, 1)).toBeNull();
  });

  it("照度を送ってこないデバイスは判定しない", () => {
    expect(resolveDeviceLightStatus({} as LatestData, { "1": 80 }, 1)).toBeNull();
  });
});

describe("formatLightStatusDetail", () => {
  it("いまの照度としきい値を並べる", () => {
    expect(
      formatLightStatusDetail({ status: "on", illuminance: 312, threshold: 80 })
    ).toBe("照度 312 lx ・ しきい値 80 lx");
  });

  it("100lx未満の照度は小数1桁まで出す（「いまの値」と同じ丸め方）", () => {
    expect(
      formatLightStatusDetail({ status: "off", illuminance: 12.4, threshold: 80 })
    ).toBe("照度 12.4 lx ・ しきい値 80 lx");
  });

  it("しきい値は入力どおりに出す（整数を 80.0 にしない）", () => {
    expect(formatLightThreshold(80)).toBe("80");
    expect(formatLightThreshold(12.5)).toBe("12.5");
  });
});
