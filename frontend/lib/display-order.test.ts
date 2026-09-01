import { describe, expect, it, vi } from "vitest";
import {
  buildDefaultDisplayOrder,
  getChartDeviceSeriesOrder,
  loadDisplayOrder,
  moveDisplayOrderItem,
  normalizeDisplayOrder,
  orderItemKey,
  saveDisplayOrder,
} from "@/lib/display-order";
import { AIRCON_CHART_DEVICE_ID } from "@/lib/types";

describe("display-order", () => {
  it("builds default order with sensors, outdoor, and aircon", () => {
    expect(buildDefaultDisplayOrder([1, 2])).toEqual([
      { type: "device", deviceId: 1 },
      { type: "device", deviceId: 2 },
      { type: "outdoor", locationId: null },
      { type: "aircon" },
    ]);
  });

  it("builds one outdoor item per location", () => {
    expect(
      buildDefaultDisplayOrder([1], {
        locationIds: ["tokyo", "osaka"],
        primaryId: "tokyo",
      }).map(orderItemKey)
    ).toEqual(["device:1", "outdoor:tokyo", "outdoor:osaka", "aircon"]);
  });

  it("reads the legacy outdoor key as the primary location", () => {
    const normalized = normalizeDisplayOrder(
      [{ type: "outdoor" }, { type: "device", deviceId: 1 }, { type: "aircon" }],
      [1],
      { locationIds: ["tokyo", "osaka"], primaryId: "tokyo" }
    );

    expect(normalized.map(orderItemKey)).toEqual([
      "outdoor:tokyo",
      "device:1",
      "aircon",
      "outdoor:osaka",
    ]);
  });

  it("drops outdoor items whose location was deleted", () => {
    const normalized = normalizeDisplayOrder(
      [
        { type: "outdoor", locationId: "gone" },
        { type: "outdoor", locationId: "tokyo" },
        { type: "device", deviceId: 1 },
        { type: "aircon" },
      ],
      [1],
      { locationIds: ["tokyo"], primaryId: "tokyo" }
    );

    expect(normalized.map(orderItemKey)).toEqual([
      "outdoor:tokyo",
      "device:1",
      "aircon",
    ]);
  });

  it("normalizes saved order and appends missing items", () => {
    const normalized = normalizeDisplayOrder(
      [
        { type: "device", deviceId: 2 },
        { type: "aircon" },
      ],
      [1, 2]
    );

    expect(normalized.map(orderItemKey)).toEqual([
      "device:2",
      "aircon",
      "device:1",
      "outdoor",
    ]);
  });

  it("moves items up and down", () => {
    const order = buildDefaultDisplayOrder([1, 2]);
    expect(moveDisplayOrderItem(order, 1, -1).map(orderItemKey)).toEqual([
      "device:2",
      "device:1",
      "outdoor",
      "aircon",
    ]);
  });

  it("loads saved order from localStorage", () => {
    const backing: Record<string, string> = {};
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => backing[key] ?? null,
        setItem: (key: string, value: string) => {
          backing[key] = value;
        },
        removeItem: (key: string) => {
          delete backing[key];
        },
      },
    });

    saveDisplayOrder([
      { type: "device", deviceId: 2 },
      { type: "outdoor" },
      { type: "device", deviceId: 1 },
      { type: "aircon" },
    ]);

    expect(loadDisplayOrder([1, 2]).map(orderItemKey)).toEqual([
      "device:2",
      "outdoor",
      "device:1",
      "aircon",
    ]);

    vi.unstubAllGlobals();
  });

  it("derives chart device order", () => {
    expect(
      getChartDeviceSeriesOrder([
        { type: "device", deviceId: 2 },
        { type: "outdoor" },
        { type: "device", deviceId: 1 },
        { type: "aircon" },
      ])
    ).toEqual([2, 1, AIRCON_CHART_DEVICE_ID]);
  });
});
