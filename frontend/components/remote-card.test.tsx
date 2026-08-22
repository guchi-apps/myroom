import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RemoteCard } from "@/components/remote-card";
import type { RemoteButtons } from "@/lib/remote";

const buttons: RemoteButtons = {
  configured: true,
  groups: [
    {
      id: "light",
      name: "照明",
      buttons: [
        { id: "light-on", label: "点ける" },
        { id: "light-off", label: "消す" },
      ],
    },
  ],
};

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

describe("RemoteCard", () => {
  it("グループ名とボタンを定義された順に並べる", () => {
    const html = render(
      <RemoteCard buttons={buttons} loading={false} error={false} />
    );
    expect(html).toContain("照明");
    expect(html.indexOf("点ける")).toBeLessThan(html.indexOf("消す"));
  });

  it("押す前は状態ではなく、赤外線を送るだけであることを書く", () => {
    const html = render(
      <RemoteCard buttons={buttons} loading={false} error={false} />
    );
    expect(html).toContain("押すと赤外線を送ります");
    // 状態を持たない設計なので、点いている・消えているといった表示は出さない
    expect(html).not.toContain("点灯中");
    expect(html).not.toContain("消灯中");
  });

  it("未設定のときは設定ファイルの場所を案内する", () => {
    const html = render(
      <RemoteCard
        buttons={{ configured: false, groups: [] }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("data/remote.json");
    expect(html).not.toContain("押すと赤外線を送ります");
  });

  it("読み込み中はボタンを出さない", () => {
    const html = render(<RemoteCard buttons={null} loading error={false} />);
    expect(html).toContain("読み込み中");
    expect(html).not.toContain("点ける");
  });

  it("読み込めなかったときはエラーを出す", () => {
    const html = render(<RemoteCard buttons={null} loading={false} error />);
    expect(html).toContain("読み込めませんでした");
  });

  it("オフラインなどで一覧が無いときも、空のカードにはしない", () => {
    const html = render(
      <RemoteCard buttons={null} loading={false} error={false} />
    );
    expect(html).toContain("読み込めませんでした");
  });
});
