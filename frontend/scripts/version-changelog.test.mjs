import { describe, expect, it } from "vitest";
import {
  CHANGELOG_PLACEHOLDER,
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
      "2026-06-19"
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

  it("falls back to the placeholder when no changes are given", () => {
    const { content } = insertChangelogEntry(sample, "2.3.0", "2026-06-19");
    expect(content).toContain(`"${CHANGELOG_PLACEHOLDER}"`);
  });

  it("writes the given changes instead of the placeholder", () => {
    const { content } = insertChangelogEntry(sample, "2.3.0", "2026-06-19", [
      "在庫の並び順を変更",
      "検索の不具合を修正",
    ]);
    expect(content).toContain('"在庫の並び順を変更",');
    expect(content).toContain('"検索の不具合を修正",');
    expect(content).not.toContain(CHANGELOG_PLACEHOLDER);
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
