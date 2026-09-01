import { describe, expect, it } from "vitest";
import { Cloud, CloudRain, Sun } from "lucide-react";
import { getWeatherIcon } from "@/lib/weather-icon";

describe("getWeatherIcon", () => {
  it("maps known icon keys to the matching lucide icon", () => {
    expect(getWeatherIcon("sun")).toBe(Sun);
    expect(getWeatherIcon("rain")).toBe(CloudRain);
  });

  it("falls back to a plain cloud icon for unknown or missing keys", () => {
    expect(getWeatherIcon(undefined)).toBe(Cloud);
    expect(getWeatherIcon(null)).toBe(Cloud);
    expect(getWeatherIcon("does-not-exist")).toBe(Cloud);
  });
});
