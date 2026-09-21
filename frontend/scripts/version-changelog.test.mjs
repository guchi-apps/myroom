import { describe, expect, it } from "vitest";
import {
  insertChangelogEntry,
  parseReleaseChangelog,
} from "./version-changelog.mjs";

const sample = `export const APP_CHANGELOG: ChangelogEntry[] = [
  {
    version: "2.2.0",
    date: "2026-06-07",
    changes: ["existing"],
  },
];
`;

describe("insertChangelogEntry", () => {
  it("inserts a new entry at the top of APP_CHANGELOG", () => {
    const { content, inserted } = insertChangelogEntry(
      sample,
      "2.3.0",
      "2026-06-19",
      ["在庫の並び順を変更"]
    );
    expect(inserted).toBe(true);
    expect(content.indexOf('version: "2.3.0"')).toBeLessThan(
      content.indexOf('version: "2.2.0"')
    );
    expect(content).toContain('date: "2026-06-19"');
  });

  it("does not duplicate an existing version", () => {
    const { inserted } = insertChangelogEntry(sample, "2.2.0", "2026-06-19");
    expect(inserted).toBe(false);
  });

  it("does not create an entry when no changes are given", () => {
    for (const changes of [undefined, []]) {
      const result = insertChangelogEntry(
        sample,
        "2.3.0",
        "2026-06-19",
        changes
      );
      expect(result.inserted).toBe(false);
      expect(result.content).toBe(sample);
    }
  });

  it("does not leave a placeholder entry behind", () => {
    const { content } = insertChangelogEntry(sample, "2.3.0", "2026-06-19");
    expect(content).not.toContain("追記してください");
    expect(content).not.toContain('version: "2.3.0"');
  });

  it("still fails when the marker is missing, even with no changes", () => {
    expect(() =>
      insertChangelogEntry("export const OTHER = [];\n", "2.3.0", "2026-06-19")
    ).toThrow("APP_CHANGELOG marker not found");
    expect(() =>
      insertChangelogEntry("export const OTHER = [];\n", "2.3.0", "2026-06-19", [
        "変更",
      ])
    ).toThrow("APP_CHANGELOG marker not found");
  });

  it("writes the given changes", () => {
    const { content } = insertChangelogEntry(sample, "2.3.0", "2026-06-19", [
      "在庫の並び順を変更",
      "検索の不具合を修正",
    ]);
    expect(content).toContain('"在庫の並び順を変更",');
    expect(content).toContain('"検索の不具合を修正",');
  });

  it("escapes characters that would break the TypeScript string literal", () => {
    const { content } = insertChangelogEntry(sample, "2.3.0", "2026-06-19", [
      '「"引用"」と \\ を含む項目',
    ]);
    expect(content).toContain('"「\\"引用\\"」と \\\\ を含む項目",');
  });
});

describe("parseReleaseChangelog", () => {
  it("returns an empty array for unset or blank input", () => {
    expect(parseReleaseChangelog(undefined)).toEqual([]);
    expect(parseReleaseChangelog("")).toEqual([]);
    expect(parseReleaseChangelog("\n  \n")).toEqual([]);
  });

  it("strips bullet markers and numbering, and drops blank lines", () => {
    const raw = ["- 項目A", "* 項目B", "・項目C", "", "1. 項目D", "2) 項目E"].join(
      "\n"
    );
    expect(parseReleaseChangelog(raw)).toEqual([
      "項目A",
      "項目B",
      "項目C",
      "項目D",
      "項目E",
    ]);
  });

  it("keeps a plain paragraph as a single item", () => {
    expect(parseReleaseChangelog("画面表示に影響する変更はありません。")).toEqual([
      "画面表示に影響する変更はありません。",
    ]);
  });
});
