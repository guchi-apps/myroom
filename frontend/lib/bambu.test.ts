import { describe, expect, it } from "vitest";
import {
  canAcknowledgeBambuPrinter,
  collectBambuErrors,
  describeLastKnown,
  formatFinishAt,
  formatObservedAt,
  formatRemaining,
  formatTargetTemperature,
  formatTemperature,
  getBambuStatusPill,
  hasJobProgress,
  isAcknowledgedIdle,
  resolveBambuView,
  type BambuPrinterResponse,
  type BambuSnapshot,
} from "@/lib/bambu";

function snapshot(overrides: Partial<BambuSnapshot> = {}): BambuSnapshot {
  return {
    state: "printing",
    rawState: "RUNNING",
    acknowledged: false,
    job: {
      name: "cable-clip_v3",
      progressPercent: 62,
      layer: 142,
      totalLayers: 230,
      remainingMinutes: 84,
      estimatedFinishAt: "2026-09-21T14:52:00+09:00",
    },
    nozzle: { temperature: 218.4, target: 220 },
    bed: { temperature: 60, target: 60 },
    speed: { level: 2, mode: "standard" },
    ams: { connected: false, units: [], activeSource: "none", activeSlot: null, externalSpool: null },
    errors: { printError: null, hms: [] },
    ...overrides,
  };
}

function response(overrides: Partial<BambuPrinterResponse> = {}): BambuPrinterResponse {
  return {
    fetchedAt: "2026-09-21T13:28:30+09:00",
    configured: true,
    connection: "online",
    online: true,
    stale: false,
    staleThresholdSeconds: 180,
    lastUpdateAt: "2026-09-21T13:28:00+09:00",
    lastMessageAt: "2026-09-21T13:28:00+09:00",
    printer: snapshot(),
    lastKnown: null,
    ...overrides,
  };
}

const NOW = "2026-09-21T13:28:30+09:00";

describe("時刻の整形", () => {
  it("同じ日は時刻だけ、前後1日は昨日・明日、それ以外は月/日を付ける", () => {
    expect(formatObservedAt("2026-09-21T13:04:00+09:00", NOW)).toBe("13:04");
    expect(formatObservedAt("2026-09-20T21:40:00+09:00", NOW)).toBe("昨日 21:40");
    expect(formatObservedAt("2026-09-22T02:10:00+09:00", NOW)).toBe("明日 02:10");
    expect(formatObservedAt("2026-09-19T21:40:00+09:00", NOW)).toBe("9/19 21:40");
    expect(formatObservedAt(null, NOW)).toBeNull();
  });

  it("完了予定は「ごろ完了」を付け、予測が無ければ null", () => {
    expect(formatFinishAt("2026-09-21T14:52:00+09:00", NOW)).toBe("14:52 ごろ完了");
    expect(formatFinishAt("2026-09-22T02:10:00+09:00", NOW)).toBe("明日 02:10 ごろ完了");
    expect(formatFinishAt(null, NOW)).toBeNull();
  });

  // 端末のタイムゾーンで解釈し直すと日付がずれる。文字列のまま切り出していること
  it("オフセット付きの文字列を端末の時計で解釈し直さない", () => {
    expect(formatObservedAt("2026-09-21T00:05:00+09:00", "2026-09-21T23:50:00+09:00")).toBe("00:05");
  });

  it("残り時間を時間と分で出す", () => {
    expect(formatRemaining(84)).toBe("1時間24分");
    expect(formatRemaining(24)).toBe("24分");
    expect(formatRemaining(120)).toBe("2時間");
    expect(formatRemaining(0)).toBe("0分");
  });
});

describe("温度の整形", () => {
  it("整数で出し、読めなければ -- にする", () => {
    expect(formatTemperature(218.4)).toBe("218");
    expect(formatTemperature(null)).toBe("--");
  });

  it("目標は加熱しているときだけ出す（0・不明は出さない）", () => {
    expect(formatTargetTemperature(220)).toBe("220");
    expect(formatTargetTemperature(0)).toBeNull();
    expect(formatTargetTemperature(null)).toBeNull();
  });
});

describe("resolveBambuView", () => {
  it("online のときだけ現在値を返す", () => {
    expect(resolveBambuView(response()).kind).toBe("current");
  });

  // 古い値を「いま」として出さない。lastKnown は現在値にならない
  it("接続なし・収集停止では lastKnown を現在値にしない", () => {
    const last = snapshot();
    const offline = resolveBambuView(
      response({ connection: "printer_offline", online: false, printer: null, lastKnown: last })
    );
    expect(offline).toEqual({ kind: "offline", lastKnown: last });
    const stale = resolveBambuView(
      response({ connection: "collector_stale", online: false, stale: true, printer: null, lastKnown: last })
    );
    expect(stale).toEqual({ kind: "stale", lastKnown: last });
  });

  it("何も届いていなければ no_data", () => {
    expect(
      resolveBambuView(
        response({ configured: false, connection: "no_data", online: false, printer: null })
      ).kind
    ).toBe("no_data");
  });
});

describe("エラーと状態のピル", () => {
  it("致命的・重大のHMSと印刷エラーだけを拾い、情報レベルは出さない", () => {
    const errors = collectBambuErrors(
      snapshot({
        errors: {
          printError: { code: "0300_4001", raw: 50348033 },
          hms: [
            { code: "HMS_0700_2000_0002_0001", severity: "serious" },
            { code: "HMS_0500_0100_0003_0004", severity: "info" },
            { code: "HMS_0300_0100_0001_0007", severity: "fatal" },
          ],
        },
      })
    );
    expect(errors.map((item) => item.code)).toEqual([
      "0300_4001",
      "HMS_0700_2000_0002_0001",
      "HMS_0300_0100_0001_0007",
    ]);
    expect(errors.map((item) => item.severityLabel)).toEqual([null, "重大", "致命的"]);
  });

  it("状態ごとのラベル", () => {
    expect(getBambuStatusPill(snapshot()).label).toBe("印刷中");
    expect(getBambuStatusPill(snapshot()).live).toBe(true);
    expect(getBambuStatusPill(snapshot({ state: "paused" })).label).toBe("一時停止");
    expect(getBambuStatusPill(snapshot({ state: "finished" })).label).toBe("完了");
    expect(getBambuStatusPill(snapshot({ state: "failed" })).label).toBe("停止");
    expect(getBambuStatusPill(snapshot({ state: "idle" })).label).toBe("待機中");
    expect(getBambuStatusPill(snapshot({ state: "unknown" })).label).toBe("状態不明");
  });

  it("停止以外でもエラーが出ていれば「エラー」を優先する", () => {
    const pill = getBambuStatusPill(
      snapshot({ errors: { printError: { code: "0300_4001", raw: 1 }, hms: [] } })
    );
    expect(pill).toEqual({ label: "エラー", tone: "bad", live: false });
  });
});

describe("最後に確認した状態", () => {
  it("名前・状態・進捗を1行にする", () => {
    expect(describeLastKnown(snapshot())).toBe("cable-clip_v3　印刷中 62%");
    expect(describeLastKnown(snapshot({ state: "finished" }))).toBe("cable-clip_v3　完了");
    expect(describeLastKnown(snapshot({ state: "idle" }))).toBe("待機中");
  });
});

describe("「取り出した」（#464）", () => {
  it("完了・停止で未確認のときだけボタンを出す", () => {
    expect(canAcknowledgeBambuPrinter(snapshot({ state: "finished" }))).toBe(true);
    expect(canAcknowledgeBambuPrinter(snapshot({ state: "failed" }))).toBe(true);
    expect(canAcknowledgeBambuPrinter(snapshot({ state: "printing" }))).toBe(false);
    expect(canAcknowledgeBambuPrinter(snapshot({ state: "finished", acknowledged: true }))).toBe(
      false
    );
  });

  it("確認済みの完了・停止は進捗を出さず、待機中のピルにする", () => {
    const acknowledged = snapshot({ state: "finished", acknowledged: true });
    expect(hasJobProgress(acknowledged)).toBe(false);
    expect(isAcknowledgedIdle(acknowledged)).toBe(true);
    expect(getBambuStatusPill(acknowledged)).toEqual({
      label: "待機中",
      tone: "idle",
      live: false,
    });
  });

  it("未確認の完了・停止は、これまでどおり進捗とピルを出す", () => {
    const notAcknowledged = snapshot({ state: "finished", acknowledged: false });
    expect(hasJobProgress(notAcknowledged)).toBe(true);
    expect(isAcknowledgedIdle(notAcknowledged)).toBe(false);
    expect(getBambuStatusPill(notAcknowledged).label).toBe("完了");
  });
});
