import type { FilamentPayload, FilamentSpool } from "@/lib/filament";

/**
 * フィラメントのテストで使う組み立て用の部品。アプリ本体からは読まない。
 * 既定はデザイン案と同じ「ホワイト: 9/14に611gで計量、以降68g使って391g（39%）」。
 */
export function makeSpool(overrides: Partial<FilamentSpool> = {}): FilamentSpool {
  return {
    id: "s1",
    name: "ELEGOO PLA (ホワイト)",
    material: "PLA",
    color: "#F4F4F2",
    purchased_on: "2026-04-02",
    net_g: 1000,
    tare_g: 152,
    archived: false,
    active: true,
    remaining_g: 391,
    percent: 39,
    level: "ok",
    base: { kind: "weighing", gross_g: 611, net_g: 459, date: "2026-09-14" },
    used_since_g: 68,
    used_since_count: 2,
    weighings: [
      {
        id: "w1",
        date: "2026-09-14",
        gross_g: 611,
        net_g: 459,
        recorded_at: "2026-09-14T10:00:00+09:00",
      },
    ],
    usages: [
      {
        id: "u2",
        date: "2026-09-21",
        grams: 42,
        note: "benchy",
        recorded_at: "2026-09-21T13:00:00+09:00",
        counted: true,
      },
      {
        id: "u1",
        date: "2026-09-18",
        grams: 26,
        note: "スマホスタンド",
        recorded_at: "2026-09-18T20:00:00+09:00",
        counted: true,
      },
      {
        id: "u0",
        date: "2026-09-10",
        grams: 80,
        note: "",
        recorded_at: "2026-09-10T20:00:00+09:00",
        counted: false,
      },
    ],
    ...overrides,
  };
}

export function makePayload(
  spools: FilamentSpool[] = [makeSpool()],
  overrides: Partial<FilamentPayload> = {}
): FilamentPayload {
  const active = spools.find((spool) => spool.active && !spool.archived);
  return {
    today: "2026-09-21",
    configured: spools.length > 0,
    active_id: active?.id ?? null,
    low_percent: 10,
    spools,
    ...overrides,
  };
}
