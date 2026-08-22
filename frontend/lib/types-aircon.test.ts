import { describe, expect, it } from "vitest";
import {
  buildAirconStatusPill,
  defaultAirconTargetForMode,
  formatAirconAutoTargetOffset,
  formatAirconModeTarget,
  formatAirconTargetTemperature,
  getAirconAutoTargetOffset,
  isAirconAutoTarget,
  stepAirconTemperature,
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

describe("stepAirconTemperature", () => {
  it("moves in half degree steps inside the fixed range", () => {
    expect(stepAirconTemperature(26, 1, "COOLING")).toBe(26.5);
    expect(stepAirconTemperature(26, -1, "COOLING")).toBe(25.5);
  });

  it("stops at the ends of the fixed range", () => {
    expect(stepAirconTemperature(32, 1, "HEATING")).toBe(32);
    expect(stepAirconTemperature(16, -1, "COOLING")).toBe(16);
  });

  it("uses the shift range while running automatically", () => {
    expect(stepAirconTemperature(0, 1, "AUTO")).toBe(0.5);
    expect(stepAirconTemperature(5, 1, "AUTO")).toBe(5);
    expect(stepAirconTemperature(-5, -1, "AUTO")).toBe(-5);
  });
});

describe("defaultAirconTargetForMode", () => {
  it("keeps the temperature while staying on the same kind of mode", () => {
    expect(defaultAirconTargetForMode("HEATING", 22, "COOLING")).toBe(22);
  });

  it("starts from no shift when switching to automatic", () => {
    expect(defaultAirconTargetForMode("AUTO", 26, "COOLING")).toBe(0);
  });

  it("starts from a normal temperature when leaving automatic", () => {
    expect(defaultAirconTargetForMode("COOLING", 1.5, "AUTO")).toBe(26);
  });
});

describe("buildAirconStatusPill", () => {
  it("shows the mode and target while running", () => {
    expect(
      buildAirconStatusPill({ mode: "COOLING", power: "ON", target_temperature: 26 })
    ).toEqual({ label: "冷房 26.0°C", color: "#3498db" });
  });

  it("shows a plain stopped label with no colour while off", () => {
    expect(
      buildAirconStatusPill({ mode: "COOLING", power: "OFF", target_temperature: 26 })
    ).toEqual({ label: "停止中", color: null });
  });

  it("falls back when nothing has been received", () => {
    expect(buildAirconStatusPill(null)).toEqual({ label: "--", color: null });
  });
});
