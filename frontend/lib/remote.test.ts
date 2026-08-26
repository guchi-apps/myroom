import { describe, expect, it } from "vitest";
import {
  countRemoteButtons,
  countVisibleRemoteButtons,
  findRemoteButton,
  formatRemoteErrorMessage,
  formatRemoteSentMessage,
  visibleRemoteGroups,
  type RemoteButtons,
} from "@/lib/remote";

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
    {
      id: "tv",
      name: "テレビ",
      buttons: [{ id: "tv-power", label: "電源" }],
    },
  ],
};

describe("countRemoteButtons", () => {
  it("グループをまたいで数える", () => {
    expect(countRemoteButtons(buttons)).toBe(3);
  });

  it("未取得なら0", () => {
    expect(countRemoteButtons(null)).toBe(0);
  });
});

describe("visibleRemoteGroups", () => {
  const withHidden: RemoteButtons = {
    configured: true,
    groups: [
      {
        id: "light",
        name: "照明",
        buttons: [
          { id: "light-on", label: "あかりをつける", default_label: "点ける" },
          { id: "light-night", label: "常夜灯", hidden: true },
        ],
      },
      {
        id: "tv",
        name: "テレビ",
        buttons: [{ id: "tv-power", label: "電源", hidden: true }],
      },
    ],
  };

  it("隠したボタンを落とす", () => {
    const groups = visibleRemoteGroups(withHidden);
    expect(groups[0].buttons.map((button) => button.id)).toEqual(["light-on"]);
  });

  it("残りが無いグループは見出しごと落とす", () => {
    expect(visibleRemoteGroups(withHidden).map((group) => group.id)).toEqual(["light"]);
  });

  it("元のオブジェクトは書き換えない", () => {
    visibleRemoteGroups(withHidden);
    expect(withHidden.groups[0].buttons).toHaveLength(2);
  });

  it("未取得なら空", () => {
    expect(visibleRemoteGroups(null)).toEqual([]);
  });

  it("hidden が無いボタンは今までどおり全部出る", () => {
    expect(visibleRemoteGroups(buttons)).toHaveLength(2);
  });

  it("表示するぶんだけを数える", () => {
    expect(countVisibleRemoteButtons(withHidden)).toBe(1);
    // 一覧そのものは隠したボタンも持ったまま
    expect(countRemoteButtons(withHidden)).toBe(3);
  });
});

describe("findRemoteButton", () => {
  it("後ろのグループのボタンも引ける", () => {
    expect(findRemoteButton(buttons, "tv-power")?.group.name).toBe("テレビ");
  });

  it("無いIDならnull", () => {
    expect(findRemoteButton(buttons, "unknown")).toBeNull();
  });
});

describe("formatRemoteSentMessage", () => {
  it("グループ名とボタン名だけを言い、機器の状態は言わない", () => {
    const message = formatRemoteSentMessage({
      sent: true,
      button_id: "light-on",
      label: "点ける",
      group_name: "照明",
    });
    expect(message).toBe("照明「点ける」を送りました");
    expect(message).not.toContain("点きました");
  });

  it("グループ名が空でも文章が崩れない", () => {
    expect(
      formatRemoteSentMessage({
        sent: true,
        button_id: "x",
        label: "電源",
        group_name: "",
      })
    ).toBe("「電源」を送りました");
  });
});

describe("formatRemoteErrorMessage", () => {
  it("APIが返した理由をそのまま出す", () => {
    expect(formatRemoteErrorMessage("Nature Remo につながりませんでした")).toBe(
      "Nature Remo につながりませんでした"
    );
  });

  it("理由が無いときだけ既定の文言へ落とす", () => {
    expect(formatRemoteErrorMessage("   ")).toBe("送信できませんでした");
    expect(formatRemoteErrorMessage(undefined)).toBe("送信できませんでした");
  });
});
