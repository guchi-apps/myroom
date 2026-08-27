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

  it("未設定のときは画面からの登録の仕方を案内する", () => {
    const html = render(
      <RemoteCard
        buttons={{ configured: false, groups: [] }}
        loading={false}
        error={false}
      />
    );
    // 設定ファイルの手編集は要らなくなった（#262）。案内するのは画面の導線
    expect(html).toContain("ダッシュボードの表示");
    expect(html).not.toContain("data/remote.json");
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

  // ---------------------------------------- 画面で選んだボタン・付けた名前（#260）

  it("設定で隠したボタンは出さない", () => {
    const html = render(
      <RemoteCard
        buttons={{
          configured: true,
          groups: [
            {
              id: "light",
              name: "照明",
              buttons: [
                { id: "light-on", label: "点ける" },
                { id: "light-night", label: "常夜灯", hidden: true },
              ],
            },
          ],
        }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("点ける");
    expect(html).not.toContain("常夜灯");
  });

  it("残ったボタンが無いグループは見出しごと出さない", () => {
    const html = render(
      <RemoteCard
        buttons={{
          configured: true,
          groups: [
            {
              id: "light",
              name: "照明",
              buttons: [{ id: "light-on", label: "点ける" }],
            },
            {
              id: "tv",
              name: "テレビ",
              buttons: [{ id: "tv-power", label: "電源", hidden: true }],
            },
          ],
        }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("照明");
    expect(html).not.toContain("テレビ");
  });

  it("全部隠したときは、空のカードにせず選び直せることを案内する", () => {
    const html = render(
      <RemoteCard
        buttons={{
          configured: true,
          groups: [
            {
              id: "light",
              name: "照明",
              buttons: [{ id: "light-on", label: "点ける", hidden: true }],
            },
          ],
        }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("ダッシュボードの表示");
    expect(html).not.toContain("点ける");
  });

  it("付けた名前をそのままボタンに出す", () => {
    const html = render(
      <RemoteCard
        buttons={{
          configured: true,
          groups: [
            {
              id: "light",
              name: "照明",
              buttons: [
                { id: "light-on", label: "あかりをつける", default_label: "点ける" },
              ],
            },
          ],
        }}
        loading={false}
        error={false}
      />
    );
    expect(html).toContain("あかりをつける");
    expect(html).not.toContain(">点ける<");
  });

  // ---------------------------------------- エアコンの入口（#268）

  const aircon = {
    title: "リビング",
    status: { label: "冷房 26.0℃", color: "#3498db" },
    onOpen: () => {},
  };

  it("エアコンの入口を、今の運転状態と一緒に出す", () => {
    const html = render(
      <RemoteCard buttons={buttons} loading={false} error={false} aircon={aircon} />
    );
    expect(html).toContain("リビング");
    expect(html).toContain("冷房 26.0℃");
    // 赤外線のボタンとは押した結果が違うので、そのことを書く
    expect(html).toContain("操作パネルが開きます");
  });

  it("操作できないときは入口ごと出さない", () => {
    const html = render(
      <RemoteCard buttons={buttons} loading={false} error={false} aircon={null} />
    );
    expect(html).not.toContain("リビング");
    expect(html).not.toContain("操作パネルが開きます");
  });

  it("赤外線のボタンが1つも無くてもエアコンの入口は出す", () => {
    const html = render(
      <RemoteCard
        buttons={{ configured: false, groups: [] }}
        loading={false}
        error={false}
        aircon={aircon}
      />
    );
    // 登録の案内は残したまま、エアコンだけは操作できる
    expect(html).toContain("ダッシュボードの表示");
    expect(html).toContain("リビング");
  });

  it("表示名を付けていないときは、見出しと行で同じ言葉を繰り返さない", () => {
    const html = render(
      <RemoteCard
        buttons={buttons}
        loading={false}
        error={false}
        aircon={{ ...aircon, title: "エアコン" }}
      />
    );
    // 行の名前は出るが、その上の見出しは省く
    expect(html).toContain(">エアコン</span>");
    expect(html).not.toContain('tracking-wider text-muted-foreground">エアコン<');
  });

  it("設定温度を隠しているときは運転状態を出さない", () => {
    const html = render(
      <RemoteCard
        buttons={buttons}
        loading={false}
        error={false}
        aircon={{ ...aircon, status: null }}
      />
    );
    expect(html).toContain("リビング");
    expect(html).not.toContain("冷房 26.0℃");
  });
});
