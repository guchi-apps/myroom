import { describe, expect, it } from "vitest";
import {
  applyCatalogSelection,
  buildRemoteConfigUpdate,
  countRemoteButtons,
  countVisibleRemoteButtons,
  findRemoteButton,
  formatCatalogFetchedAt,
  formatRemoteErrorMessage,
  formatRemoteSentMessage,
  hasSelectableRemoteButtons,
  moveRemoteButton,
  moveRemoteGroup,
  removeRemoteButton,
  toGroupDrafts,
  visibleRemoteGroups,
  type RemoteButtons,
  type RemoteCatalog,
  type RemoteGroupDraft,
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

// -------------------------------------------- 画面からの登録（#262）

const catalog: RemoteCatalog = {
  fetched_at: "2026-08-26T11:14:00Z",
  devices: [
    {
      id: "d-light",
      name: "リビングの照明",
      type: "LIGHT",
      note: "",
      buttons: [
        { id: "l-on", label: "点ける", kind: "light" },
        { id: "l-off", label: "消す", kind: "light" },
        { id: "l-night", label: "常夜灯", kind: "light" },
      ],
    },
    {
      id: "d-tv",
      name: "テレビ",
      type: "TV",
      note: "",
      buttons: [{ id: "s-power", label: "電源", kind: "signal" }],
    },
    { id: "d-ac", name: "エアコン", type: "AC", note: "押せません", buttons: [] },
  ],
};

const drafts: RemoteGroupDraft[] = [
  {
    id: "d-light",
    name: "あかり",
    buttons: [
      { id: "l-on", defaultLabel: "点ける" },
      { id: "l-off", defaultLabel: "消す" },
    ],
  },
];

describe("toGroupDrafts", () => {
  it("登録内容として持つのは Nature Remo 側の名前のほう", () => {
    const withOverride: RemoteButtons = {
      configured: true,
      groups: [
        {
          id: "light",
          name: "照明",
          buttons: [{ id: "l-on", label: "つける", default_label: "点ける" }],
        },
      ],
    };
    expect(toGroupDrafts(withOverride)[0].buttons[0].defaultLabel).toBe("点ける");
  });
});

describe("applyCatalogSelection", () => {
  it("新しく選んだ操作を、その機器のグループへ足す", () => {
    const next = applyCatalogSelection(
      drafts,
      catalog,
      new Set(["l-on", "l-off", "s-power"])
    );
    expect(next.map((group) => group.name)).toEqual(["あかり", "テレビ"]);
    expect(next[1].buttons.map((button) => button.id)).toEqual(["s-power"]);
  });

  it("既にあるボタンの位置は動かさず、追加だけ末尾へ付ける", () => {
    const next = applyCatalogSelection(
      drafts,
      catalog,
      new Set(["l-on", "l-off", "l-night"])
    );
    expect(next).toHaveLength(1);
    expect(next[0].buttons.map((button) => button.id)).toEqual(["l-on", "l-off", "l-night"]);
    // 付け替えたグループ名は保つ（機器のニックネームへ戻さない）
    expect(next[0].name).toBe("あかり");
  });

  it("選択が外れたボタンを落とし、空になったグループは見出しごと消す", () => {
    expect(applyCatalogSelection(drafts, catalog, new Set())).toEqual([]);
    const next = applyCatalogSelection(drafts, catalog, new Set(["l-off"]));
    expect(next[0].buttons.map((button) => button.id)).toEqual(["l-off"]);
  });
});

describe("moveRemoteGroup", () => {
  const three: RemoteGroupDraft[] = [
    { id: "a", name: "A", buttons: [{ id: "1", defaultLabel: "1" }] },
    { id: "b", name: "B", buttons: [{ id: "2", defaultLabel: "2" }] },
    { id: "c", name: "C", buttons: [{ id: "3", defaultLabel: "3" }] },
  ];

  it("上下に入れ替える", () => {
    expect(moveRemoteGroup(three, 1, -1).map((g) => g.id)).toEqual(["b", "a", "c"]);
    expect(moveRemoteGroup(three, 1, 1).map((g) => g.id)).toEqual(["a", "c", "b"]);
  });

  it("端では動かさない", () => {
    expect(moveRemoteGroup(three, 0, -1)).toBe(three);
    expect(moveRemoteGroup(three, 2, 1)).toBe(three);
  });
});

describe("moveRemoteButton", () => {
  const groups: RemoteGroupDraft[] = [
    {
      id: "light",
      name: "あかり",
      buttons: [
        { id: "l-on", defaultLabel: "on" },
        { id: "l-night", defaultLabel: "night" },
        { id: "l-off", defaultLabel: "off" },
      ],
    },
    { id: "tv", name: "テレビ", buttons: [{ id: "s-power", defaultLabel: "power" }] },
  ];

  it("グループの中で上下に入れ替える", () => {
    expect(moveRemoteButton(groups, 0, 1, -1)[0].buttons.map((b) => b.id)).toEqual([
      "l-night",
      "l-on",
      "l-off",
    ]);
    expect(moveRemoteButton(groups, 0, 1, 1)[0].buttons.map((b) => b.id)).toEqual([
      "l-on",
      "l-off",
      "l-night",
    ]);
  });

  it("端では動かさない", () => {
    expect(moveRemoteButton(groups, 0, 0, -1)).toBe(groups);
    expect(moveRemoteButton(groups, 0, 2, 1)).toBe(groups);
    // 1つしか入っていないグループはどちらへも動かない
    expect(moveRemoteButton(groups, 1, 0, -1)).toBe(groups);
    expect(moveRemoteButton(groups, 1, 0, 1)).toBe(groups);
  });

  it("他のグループと元の配列は書き換えない", () => {
    const next = moveRemoteButton(groups, 0, 0, 1);
    expect(next[1]).toBe(groups[1]);
    expect(groups[0].buttons.map((b) => b.id)).toEqual(["l-on", "l-night", "l-off"]);
  });

  it("無いグループを指されても落ちない", () => {
    expect(moveRemoteButton(groups, 5, 0, 1)).toBe(groups);
  });
});

describe("removeRemoteButton", () => {
  it("最後の1つを外すとグループごと消える", () => {
    const next = removeRemoteButton(removeRemoteButton(drafts, "l-on"), "l-off");
    expect(next).toEqual([]);
  });
});

describe("buildRemoteConfigUpdate", () => {
  it("ボタンはIDだけ送り、グループ名の前後の空白は落とす", () => {
    const update = buildRemoteConfigUpdate(
      [{ id: "d-light", name: "  あかり  ", buttons: [{ id: "l-on", defaultLabel: "点ける" }] }],
      {}
    );
    expect(update.groups).toEqual([
      { id: "d-light", name: "あかり", buttons: [{ id: "l-on" }] },
    ]);
  });

  it("登録から外したボタンの設定は送らない", () => {
    const update = buildRemoteConfigUpdate(drafts, {
      "l-on": { label: "つける" },
      "s-power": { label: "電源" },
    });
    expect(Object.keys(update.buttons)).toEqual(["l-on"]);
  });
});

describe("formatCatalogFetchedAt", () => {
  it("まだ取っていなければ空", () => {
    expect(formatCatalogFetchedAt("")).toBe("");
    expect(formatCatalogFetchedAt("ISOではない")).toBe("");
  });

  it("月日と時刻の形にする", () => {
    expect(formatCatalogFetchedAt("2026-08-26T11:14:00Z")).toMatch(/^\d+\/\d+ \d{2}:\d{2}$/);
  });
});

describe("hasSelectableRemoteButtons", () => {
  it("押せる操作が1つも無い一覧では false", () => {
    expect(hasSelectableRemoteButtons(null)).toBe(false);
    expect(
      hasSelectableRemoteButtons({ fetched_at: "", devices: [catalog.devices[2]] })
    ).toBe(false);
    expect(hasSelectableRemoteButtons(catalog)).toBe(true);
  });
});
