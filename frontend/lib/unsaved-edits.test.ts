import { beforeEach, describe, expect, it } from "vitest";
import {
  beginUnsavedEdits,
  hasUnsavedEdits,
  resetUnsavedEdits,
} from "@/lib/unsaved-edits";

describe("unsaved-edits", () => {
  beforeEach(() => {
    resetUnsavedEdits();
  });

  it("何も開いていなければ false", () => {
    expect(hasUnsavedEdits()).toBe(false);
  });

  it("開いている間だけ true になる", () => {
    const release = beginUnsavedEdits();
    expect(hasUnsavedEdits()).toBe(true);
    release();
    expect(hasUnsavedEdits()).toBe(false);
  });

  it("複数が重なっても、最後の1つが閉じるまで true", () => {
    const first = beginUnsavedEdits();
    const second = beginUnsavedEdits();
    first();
    expect(hasUnsavedEdits()).toBe(true);
    second();
    expect(hasUnsavedEdits()).toBe(false);
  });

  it("同じ後始末を二度呼んでもカウンタが崩れない", () => {
    const outer = beginUnsavedEdits();
    const inner = beginUnsavedEdits();
    inner();
    inner();
    expect(hasUnsavedEdits()).toBe(true);
    outer();
    expect(hasUnsavedEdits()).toBe(false);
  });
});
