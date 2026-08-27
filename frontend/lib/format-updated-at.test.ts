import { describe, expect, it } from "vitest";
import { formatUpdatedAt } from "@/lib/format-updated-at";

describe("formatUpdatedAt", () => {
  const now = new Date(2026, 7, 27, 21, 50); // 2026-08-27 21:50

  it("同じ日なら時刻だけを出す", () => {
    expect(formatUpdatedAt(new Date(2026, 7, 27, 21, 46).getTime(), now)).toBe("21:46");
  });

  it("0時台でも時と分を0詰めする", () => {
    expect(formatUpdatedAt(new Date(2026, 7, 27, 9, 5).getTime(), now)).toBe("09:05");
  });

  it("日をまたいでいれば月日を足す", () => {
    expect(formatUpdatedAt(new Date(2026, 7, 26, 21, 46).getTime(), now)).toBe("8/26 21:46");
  });

  it("年が違っていても月日と時刻で出す", () => {
    expect(formatUpdatedAt(new Date(2025, 11, 31, 23, 59).getTime(), now)).toBe("12/31 23:59");
  });

  it("値が無ければ -- を返す", () => {
    expect(formatUpdatedAt(null, now)).toBe("--");
    expect(formatUpdatedAt(Number.NaN, now)).toBe("--");
  });
});
