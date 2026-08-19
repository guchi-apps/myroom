import { describe, expect, it } from "vitest";
import {
  formatAirconAutoTargetOffset,
  formatAirconModeTarget,
  formatAirconTargetTemperature,
  getAirconAutoTargetOffset,
  isAirconAutoTarget,
} from "@/lib/types";

describe("isAirconAutoTarget", () => {
  it("treats the automatic shift range as automatic operation", () => {
    expect(isAirconAutoTarget(0)).toBe(true);
    expect(isAirconAutoTarget(1)).toBe(true);
    expect(isAirconAutoTarget(-1.5)).toBe(true);
    expect(isAirconAutoTarget(3)).toBe(true);
  });

  it("treats a real target temperature as a fixed value", () => {
    expect(isAirconAutoTarget(16)).toBe(false);
    expect(isAirconAutoTarget(26)).toBe(false);
    expect(isAirconAutoTarget(32)).toBe(false);
  });

  it("ignores non numeric values", () => {
    expect(isAirconAutoTarget(null)).toBe(false);
    expect(isAirconAutoTarget(undefined)).toBe(false);
    expect(isAirconAutoTarget("1")).toBe(false);
    expect(isAirconAutoTarget(Number.NaN)).toBe(false);
  });
});

describe("getAirconAutoTargetOffset", () => {
  it("returns the shift itself while in automatic operation", () => {
    expect(getAirconAutoTargetOffset(1)).toBe(1);
    expect(getAirconAutoTargetOffset(0)).toBe(0);
    expect(getAirconAutoTargetOffset(-2.5)).toBe(-2.5);
  });

  it("returns undefined for a fixed target temperature", () => {
    expect(getAirconAutoTargetOffset(26)).toBeUndefined();
  });
});

describe("formatAirconAutoTargetOffset", () => {
  it("keeps the sign", () => {
    expect(formatAirconAutoTargetOffset(1)).toBe("+1.0°C");
    expect(formatAirconAutoTargetOffset(-1.5)).toBe("-1.5°C");
    expect(formatAirconAutoTargetOffset(1, { withUnit: false })).toBe("+1.0");
  });

  it("returns an empty string when there is no shift", () => {
    expect(formatAirconAutoTargetOffset(0)).toBe("");
  });
});

describe("formatAirconTargetTemperature", () => {
  it("shows a fixed target temperature as is", () => {
    expect(formatAirconTargetTemperature(26)).toBe("26.0°C");
    expect(formatAirconTargetTemperature(26, { withUnit: false })).toBe("26.0");
  });

  it("shows the automatic shift with its sign", () => {
    expect(formatAirconTargetTemperature(0)).toBe("自動");
    expect(formatAirconTargetTemperature(1)).toBe("自動 +1.0°C");
    expect(formatAirconTargetTemperature(-0.5)).toBe("自動 -0.5°C");
  });

  it("shows a placeholder when there is no value", () => {
    expect(formatAirconTargetTemperature(null)).toBe("--");
    expect(formatAirconTargetTemperature(undefined)).toBe("--");
  });
});

describe("formatAirconModeTarget", () => {
  it("combines mode and fixed target temperature", () => {
    expect(
      formatAirconModeTarget({ mode: "COOLING", power: "ON", target_temperature: 26 })
    ).toBe("冷房 26.0°C");
  });

  it("does not repeat the automatic label", () => {
    expect(
      formatAirconModeTarget({ mode: "AUTO", power: "ON", target_temperature: 0 })
    ).toBe("自動");
    expect(
      formatAirconModeTarget({ mode: "AUTO", power: "ON", target_temperature: 1 })
    ).toBe("自動 +1.0°C");
  });

  it("keeps the mode when the shift comes with another mode", () => {
    expect(
      formatAirconModeTarget({ mode: "COOLING", power: "ON", target_temperature: 1 })
    ).toBe("冷房 自動 +1.0°C");
  });

  it("shows only the state while the aircon is off or has no target", () => {
    expect(
      formatAirconModeTarget({ mode: "COOLING", power: "OFF", target_temperature: 26 })
    ).toBe("停止");
    expect(formatAirconModeTarget({ mode: "FAN", power: "ON" })).toBe("送風");
  });
});
