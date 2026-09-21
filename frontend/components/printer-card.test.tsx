import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PrinterCard } from "@/components/printer-card";
import type { BambuPrinterResponse, BambuSnapshot } from "@/lib/bambu";
import { makePayload, makeSpool } from "@/lib/filament-fixtures";
import type { FilamentPayload } from "@/lib/filament";

function snapshot(overrides: Partial<BambuSnapshot> = {}): BambuSnapshot {
  return {
    state: "printing",
    rawState: "RUNNING",
    job: {
      name: "cable-clip_v3",
      progressPercent: 62,
      layer: 142,
      totalLayers: 230,
      remainingMinutes: 84,
      estimatedFinishAt: "2026-09-21T14:52:00+09:00",
    },
    nozzle: { temperature: 218.4, target: 220 },
    bed: { temperature: 59.6, target: 60 },
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

function render(
  printer: BambuPrinterResponse | null,
  extra?: {
    loading?: boolean;
    error?: boolean;
    filament?: FilamentPayload | null;
    onOpenFilament?: () => void;
  }
) {
  return renderToStaticMarkup(
    <PrinterCard
      printer={printer}
      loading={extra?.loading ?? false}
      error={extra?.error ?? false}
      filament={extra?.filament}
      onOpenFilament={extra?.onOpenFilament}
    />
  );
}

describe("PrinterCard", () => {
  it("印刷中は進捗・残り時間・完了予定・層・温度・時点を出す", () => {
    const html = render(response());
    expect(html).toContain("3Dプリンター");
    expect(html).toContain("印刷中");
    expect(html).toContain("cable-clip_v3");
    expect(html).toContain('aria-valuenow="62"');
    expect(html).toContain("残り 1時間24分");
    expect(html).toContain("14:52 ごろ完了");
    expect(html).toContain("142 / 230 層");
    expect(html).toContain("速度 標準");
    // ノズル・ベッドの現在値（四捨五入）と目標
    expect(html).toContain("218");
    expect(html).toContain("/ 目標 220°C");
    expect(html).toContain("60");
    expect(html).toContain("13:28 時点");
  });

  it("待機中は「印刷していません」と温度だけ出し、進捗バーは出さない", () => {
    const html = render(
      response({
        printer: snapshot({
          state: "idle",
          rawState: "IDLE",
          nozzle: { temperature: 24, target: 0 },
          bed: { temperature: 23, target: 0 },
        }),
      })
    );
    expect(html).toContain("待機中");
    expect(html).toContain("印刷していません");
    expect(html).not.toContain("progressbar");
    // 目標が0（加熱していない）のときは「目標」を出さない
    expect(html).not.toContain("目標");
  });

  it("完了と停止のとき、ピルと文言が変わる", () => {
    const finished = render(
      response({ printer: snapshot({ state: "finished", job: { ...snapshot().job, progressPercent: 100, remainingMinutes: null, estimatedFinishAt: null } }) })
    );
    expect(finished).toContain("完了");
    expect(finished).toContain("印刷が終わりました");
    expect(finished).not.toContain("ごろ完了");

    const failed = render(
      response({
        printer: snapshot({
          state: "failed",
          errors: {
            printError: { code: "0300_4001", raw: 50348033 },
            hms: [{ code: "HMS_0700_2000_0002_0001", severity: "serious" }],
          },
        }),
      })
    );
    expect(failed).toContain("停止");
    expect(failed).toContain("印刷が止まりました");
    expect(failed).toContain("0300_4001");
    expect(failed).toContain("HMS_0700_2000_0002_0001");
    expect(failed).toContain("（重大）");
  });

  it("一時停止のとき、完了予定は出さない", () => {
    const html = render(response({ printer: snapshot({ state: "paused", rawState: "PAUSE" }) }));
    expect(html).toContain("一時停止");
    expect(html).toContain("残り 1時間24分");
    expect(html).not.toContain("ごろ完了");
  });

  it("プリンターに繋がっていないときは現在値を出さず、最後の状態を添える", () => {
    const html = render(
      response({
        connection: "printer_offline",
        online: false,
        printer: null,
        lastKnown: snapshot({ state: "finished", job: { ...snapshot().job, progressPercent: 100 } }),
        lastMessageAt: "2026-09-20T21:40:00+09:00",
      })
    );
    expect(html).toContain("オフライン");
    expect(html).toContain("プリンターに繋がっていません");
    expect(html).toContain("最後に確認した状態・昨日 21:40");
    expect(html).toContain("cable-clip_v3　完了");
    // 温度・進捗バーは「いま」の値として出さない
    expect(html).not.toContain("ノズル");
    expect(html).not.toContain("progressbar");
  });

  it("収集が止まっているときも現在値を出さず、閾値の分数を案内する", () => {
    const html = render(
      response({
        connection: "collector_stale",
        online: false,
        stale: true,
        printer: null,
        lastKnown: snapshot(),
        lastUpdateAt: "2026-09-21T13:04:00+09:00",
      })
    );
    expect(html).toContain("情報が古い");
    expect(html).toContain("3分以上、プリンターの状態が届いていません");
    expect(html).toContain("最後に確認した状態・13:04");
    expect(html).toContain("cable-clip_v3　印刷中 62%");
    expect(html).not.toContain("ノズル");
    expect(html).not.toContain("progressbar");
  });

  it("まだ何も届いていないときは案内だけ出す", () => {
    const html = render(
      response({ configured: false, connection: "no_data", online: false, printer: null })
    );
    expect(html).toContain("3Dプリンターの状態がまだ届いていません");
    expect(html).not.toContain("最後に確認した状態");
  });

  it("読み込み中と取得失敗を出し分ける", () => {
    expect(render(null, { loading: true })).toContain("読み込み中...");
    expect(render(null, { error: true })).toContain("3Dプリンターの状態を読み込めませんでした");
    // 読み込み中はピル（状態）を出さない
    expect(render(response(), { loading: true })).not.toContain("印刷中");
  });

  // 自動で取れる材料・色は実物のスプールと合わないことが多いので、カードには出さない（#453）
  it("プリンターから取れる材料・色（AMS Lite・外付けスプール）は出さない", () => {
    const tray = (slot: number, material: string) => ({
      slot,
      empty: false,
      material,
      brand: null,
      color: "#2B2B2B",
      remainPercent: 62,
    });
    const withAms = render(
      response({
        printer: snapshot({
          ams: {
            connected: true,
            units: [{ id: 0, humidity: 4, slots: [tray(0, "PLA"), tray(1, "PETG")] }],
            activeSource: "ams",
            activeSlot: 1,
            externalSpool: null,
          },
        }),
      })
    );
    const withExternal = render(
      response({
        printer: snapshot({
          ams: {
            connected: false,
            units: [],
            activeSource: "external",
            activeSlot: null,
            externalSpool: tray(254, "PLA"),
          },
        }),
      })
    );
    for (const html of [withAms, withExternal]) {
      expect(html).not.toContain("フィラメント");
      expect(html).not.toContain("外付けスプール");
      expect(html).not.toContain("PETG");
      // 温度と更新時刻は今までどおり出す
      expect(html).toContain("ノズル");
      expect(html).toContain("13:28 時点");
    }
  });

  describe("フィラメント残量（#445）", () => {
    const open = () => {};

    it("使用中スプールの残量・割合・入口を出す", () => {
      const html = render(response(), { filament: makePayload(), onOpenFilament: open });
      expect(html).toContain("フィラメント残量");
      expect(html).toContain("ELEGOO PLA (ホワイト)");
      expect(html).toContain(">391<");
      expect(html).toContain("39%");
      expect(html).toContain("9/14に計量、以降2回で68g");
      expect(html).toContain("在庫 1本");
      expect(html).toContain("在庫を開く");
      expect(html).toContain('aria-valuenow="39"');
    });

    it("在庫を渡さなければ欄ごと出さない（既存の表示は変わらない）", () => {
      expect(render(response())).not.toContain("フィラメント残量");
      expect(render(response(), { filament: makePayload() })).not.toContain("フィラメント残量");
    });

    it("プリンターがオフラインでも残量は出す", () => {
      const html = render(
        response({ online: false, connection: "printer_offline", printer: null, lastKnown: snapshot() }),
        { filament: makePayload(), onOpenFilament: open }
      );
      expect(html).toContain("プリンターに繋がっていません");
      expect(html).toContain("ELEGOO PLA (ホワイト)");
    });

    it("プリンターを読み込み中のあいだは出さない", () => {
      const html = render(null, { loading: true, filament: makePayload(), onOpenFilament: open });
      expect(html).not.toContain("フィラメント残量");
    });

    it("残りわずかのときは注記と警告色を出す", () => {
      const html = render(response(), {
        filament: makePayload([
          makeSpool({ remaining_g: 62, percent: 6, level: "low" }),
        ]),
        onOpenFilament: open,
      });
      expect(html).toContain("残りわずか");
      expect(html).toContain("text-[#a86200]");
    });

    it("スプールが1本も無いときは登録を促す", () => {
      const html = render(response(), { filament: makePayload([]), onOpenFilament: open });
      expect(html).toContain("スプールを登録すると、残量を計算します");
    });

    it("使用中が選ばれていないときは、選ぶよう伝えて入口は残す", () => {
      const html = render(response(), {
        filament: makePayload([makeSpool({ active: false })], { active_id: null }),
        onOpenFilament: open,
      });
      expect(html).toContain("使用中のスプールが選ばれていません");
      expect(html).toContain("在庫を開く");
    });
  });
});
