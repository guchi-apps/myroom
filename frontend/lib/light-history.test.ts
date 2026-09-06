import { describe, expect, it } from "vitest";
import {
  buildBandPieces,
  draftToLightSource,
  filterEventsToDomain,
  formatDuration,
  formatEventTime,
  formatLightSourceLabel,
  formatLightSourceNote,
  lightSourceToDraft,
  spansMultipleDays,
  type LightHistoryEvent,
  type LightSegment,
} from "@/lib/light-history";

function segment(
  start: string,
  end: string,
  extra: Partial<LightSegment> = {}
): LightSegment {
  return {
    start,
    end,
    open_start: false,
    open_end: false,
    daylight: false,
    ...extra,
  };
}

const DAY_START = new Date("2026-09-06T00:00:00").getTime();
const DAY_END = new Date("2026-09-07T00:00:00").getTime();
const DAY: [number, number] = [DAY_START, DAY_END];

describe("formatDuration", () => {
  it("時間と分に分ける", () => {
    expect(formatDuration(277)).toBe("4時間37分");
  });

  it("1時間未満は分だけ", () => {
    expect(formatDuration(37)).toBe("37分");
  });

  it("ちょうどの時間は分を出さない", () => {
    expect(formatDuration(120)).toBe("2時間");
  });

  it("0分でも「0時間」にしない", () => {
    // 点けてすぐ消した記録が「0時間」になると、記録が壊れているように見える
    expect(formatDuration(0)).toBe("0分");
  });
});

describe("formatEventTime", () => {
  it("同じ日に収まる期間なら時刻だけ", () => {
    expect(formatEventTime("2026-09-06T18:35:00", false)).toBe("18:35");
  });

  it("日をまたぐ期間なら日付を添える", () => {
    expect(formatEventTime("2026-09-05T18:35:00", true)).toBe("9/5 18:35");
  });
});

describe("spansMultipleDays", () => {
  it("同じ日なら false", () => {
    expect(spansMultipleDays("2026-09-06T00:00:00", "2026-09-06T23:59:00")).toBe(false);
  });

  it("またぐなら true", () => {
    expect(spansMultipleDays("2026-09-05T00:00:00", "2026-09-06T23:59:00")).toBe(true);
  });
});

describe("buildBandPieces", () => {
  it("区間を時間軸上の割合へ直す", () => {
    const [piece] = buildBandPieces(
      [segment("2026-09-06T06:00:00", "2026-09-06T12:00:00")],
      DAY
    );
    expect(piece.left).toBeCloseTo(0.25, 5);
    expect(piece.width).toBeCloseTo(0.25, 5);
  });

  it("表示範囲の外の区間は落とす", () => {
    expect(
      buildBandPieces([segment("2026-09-04T06:00:00", "2026-09-04T12:00:00")], DAY)
    ).toEqual([]);
  });

  it("はみ出した区間は切り、切った側に印を立てる", () => {
    const [piece] = buildBandPieces(
      [segment("2026-09-05T18:00:00", "2026-09-06T01:00:00")],
      DAY
    );
    expect(piece.left).toBe(0);
    expect(piece.openStart).toBe(true);
    expect(piece.openEnd).toBe(false);
  });

  it("もともと期間の外へ続いている印はそのまま残す", () => {
    const [piece] = buildBandPieces(
      [
        segment("2026-09-06T18:00:00", "2026-09-07T00:00:00", {
          open_end: true,
        }),
      ],
      DAY
    );
    expect(piece.openEnd).toBe(true);
  });

  it("時間軸の幅が0なら何も返さない", () => {
    expect(buildBandPieces([segment("2026-09-06T06:00:00", "2026-09-06T12:00:00")], [
      DAY_START,
      DAY_START,
    ])).toEqual([]);
  });
});

describe("filterEventsToDomain", () => {
  const events: LightHistoryEvent[] = [
    {
      datetime: "2026-09-06T18:35:00",
      status: "on",
      duration_minutes: 60,
      continuing: true,
      daylight: false,
    },
    {
      datetime: "2026-09-04T08:10:00",
      status: "off",
      duration_minutes: 60,
      continuing: false,
      daylight: false,
    },
  ];

  it("表示中の範囲に入る行だけ残す", () => {
    expect(filterEventsToDomain(events, DAY).map((event) => event.datetime)).toEqual([
      "2026-09-06T18:35:00",
    ]);
  });
});

describe("選択欄の値と保存する形の相互変換", () => {
  it("未設定は空文字（＝紐付けを外す）", () => {
    expect(lightSourceToDraft(null)).toBe("");
    expect(draftToLightSource("")).toBeNull();
  });

  it("照度からの判定を往復できる", () => {
    expect(lightSourceToDraft({ kind: "illuminance" })).toBe("illuminance");
    expect(draftToLightSource("illuminance")).toEqual({ kind: "illuminance" });
  });

  it("Nature Remo の機器を往復できる", () => {
    const source = { kind: "remo", appliance_key: "d-1f2e3d4c5b" } as const;
    expect(lightSourceToDraft(source)).toBe("remo:d-1f2e3d4c5b");
    expect(draftToLightSource("remo:d-1f2e3d4c5b")).toEqual(source);
  });

  it("機器を指していない remo は紐付けなしとして扱う", () => {
    expect(draftToLightSource("remo:")).toBeNull();
  });
});

describe("判定の根拠の文言", () => {
  it("照度から判定するときはしきい値を出す", () => {
    expect(
      formatLightSourceNote({ kind: "illuminance", name: "", threshold: 80 })
    ).toContain("80 lx");
  });

  it("しきい値が未設定なら設定を促す", () => {
    expect(
      formatLightSourceNote({ kind: "illuminance", name: "", threshold: null })
    ).toContain("設定");
  });

  it("Nature Remo から読むときは機器名を出す", () => {
    expect(
      formatLightSourceNote({ kind: "remo", name: "洋室照明", threshold: null })
    ).toContain("洋室照明");
  });

  it("帯の見出しは判定元が分かる形にする", () => {
    expect(formatLightSourceLabel({ kind: "illuminance", name: "", threshold: 80 })).toBe(
      "照度から判定"
    );
    expect(
      formatLightSourceLabel({ kind: "remo", name: "洋室照明", threshold: null })
    ).toBe("洋室照明 · Nature Remo の状態");
  });
});
