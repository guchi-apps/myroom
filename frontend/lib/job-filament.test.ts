import { describe, expect, it } from "vitest";
import type { BambuJobFilament, BambuSnapshot } from "@/lib/bambu";
import { makePayload, makeSpool } from "@/lib/filament-fixtures";
import { buildJobFilamentView } from "@/lib/job-filament";

const JOB_KEY = "benchy@2026-09-21T13:00:00+09:00";

function jobFilament(overrides: Partial<BambuJobFilament> = {}): BambuJobFilament {
  return {
    jobKey: JOB_KEY,
    name: "benchy",
    totalGrams: 24.4,
    filaments: [{ slot: 1, material: "PLA", color: "#BCBCBC", usedGrams: 24.41 }],
    ...overrides,
  };
}

function snapshot(
  state: BambuSnapshot["state"],
  filament: BambuJobFilament | null | undefined = jobFilament()
): BambuSnapshot {
  return {
    state,
    rawState: null,
    acknowledged: false,
    job: {
      name: "benchy",
      progressPercent: 50,
      layer: 1,
      totalLayers: 2,
      remainingMinutes: null,
      estimatedFinishAt: null,
      filament,
    },
    nozzle: { temperature: null, target: null },
    bed: { temperature: null, target: null },
    speed: { level: null, mode: null },
    ams: { connected: false, units: [], activeSource: "none", activeSlot: null, externalSpool: null },
    errors: { printError: null, hms: [] },
  };
}

function deductedSpool(source: "auto" | "auto_estimate", grams = 24.4) {
  const base = makeSpool();
  return makeSpool({
    usages: [
      {
        id: "ua",
        date: "2026-09-21",
        grams,
        note: "benchy",
        recorded_at: "2026-09-21T13:30:00+09:00",
        counted: true,
        source,
        job_key: JOB_KEY,
      },
      ...base.usages,
    ],
  });
}

describe("印刷中の使用量", () => {
  it("完了すると使用中のスプールから引くことを予告する", () => {
    const view = buildJobFilamentView(snapshot("printing"), makePayload());
    expect(view).toMatchObject({ tone: "pending", grams: 24.4, deducted: false });
    expect(view?.detail).toBe("完了すると「ELEGOO PLA (ホワイト)」から差し引きます");
    expect(view?.swatchColor).toBe("#F4F4F2");
  });

  it("使用中のスプールが無ければ、引かないことを先に伝える", () => {
    const view = buildJobFilamentView(
      snapshot("printing"),
      makePayload([makeSpool({ active: false })], { active_id: null })
    );
    expect(view?.tone).toBe("muted");
    expect(view?.detail).toContain("使用中のスプールが無いため");
  });

  it("複数色は自動では引かない", () => {
    const two = jobFilament({
      filaments: [
        { slot: 1, material: "PLA", color: null, usedGrams: 20 },
        { slot: 2, material: "PLA", color: null, usedGrams: 4.4 },
      ],
    });
    const view = buildJobFilamentView(snapshot("printing", two), makePayload());
    expect(view?.detail).toContain("複数色");
  });

  it("在庫を読み込む前でも予定の量は出す", () => {
    const view = buildJobFilamentView(snapshot("preparing"), null);
    expect(view?.tone).toBe("pending");
    expect(view?.grams).toBe(24.4);
  });

  it("使用量が読めていなければ何も出さない", () => {
    expect(buildJobFilamentView(snapshot("printing", null), makePayload())).toBeNull();
    // 古いレスポンス（キャッシュ）には項目そのものが無い
    const legacy = snapshot("printing");
    delete legacy.job.filament;
    expect(buildJobFilamentView(legacy, makePayload())).toBeNull();
  });

  it("待機中は前の造形の値を出さない", () => {
    expect(buildJobFilamentView(snapshot("idle"), makePayload())).toBeNull();
  });
});

describe("終わったあとの使用量", () => {
  it("在庫に自動の記録があれば、引いた量と先のスプールを出す", () => {
    const view = buildJobFilamentView(snapshot("finished"), makePayload([deductedSpool("auto")]));
    expect(view).toMatchObject({ tone: "done", deducted: true, grams: 24.4 });
    expect(view?.title).toBe("使用量を差し引きました");
    expect(view?.detail).toContain("ELEGOO PLA (ホワイト)");
  });

  it("途中で止まった概算は、概算だと分かる言い方にする", () => {
    const view = buildJobFilamentView(
      snapshot("failed"),
      makePayload([deductedSpool("auto_estimate", 10.3)])
    );
    expect(view).toMatchObject({ tone: "estimate", deducted: true, grams: 10.3 });
    expect(view?.title).toContain("概算");
  });

  it("別の造形の記録は「引いた」と数えない", () => {
    const payload = makePayload([deductedSpool("auto")]);
    const other = snapshot("finished", jobFilament({ jobKey: "other@2026-09-21T09:00:00+09:00" }));
    const view = buildJobFilamentView(other, payload);
    expect(view?.tone).toBe("muted");
    expect(view?.deducted).toBe(false);
  });

  it("記録が無く使用中のスプールも無ければ、その理由を出す", () => {
    const view = buildJobFilamentView(
      snapshot("finished"),
      makePayload([makeSpool({ active: false })], { active_id: null })
    );
    expect(view?.detail).toContain("使用中のスプールが無かった");
  });

  it("記録が無いだけなら、在庫に反映されていないと伝える", () => {
    const view = buildJobFilamentView(snapshot("finished"), makePayload());
    expect(view?.tone).toBe("muted");
    expect(view?.detail).toContain("在庫には反映されていません");
  });

  it("在庫を読み込む前は、引いたかどうか分からないので出さない", () => {
    expect(buildJobFilamentView(snapshot("finished"), null)).toBeNull();
  });
});
