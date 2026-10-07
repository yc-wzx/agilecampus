import { describe, it, expect } from "vitest";
import {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PAGE_OFFSET_MAX,
} from "@/contracts/p0-p2";
import { normalizePage, pageResult } from "@/lib/pagination";

describe("normalizePage", () => {
  it("默认 limit 50 / offset 0", () => {
    expect(normalizePage()).toEqual({ offset: 0, limit: PAGE_LIMIT_DEFAULT });
    expect(normalizePage({})).toEqual({ offset: 0, limit: PAGE_LIMIT_DEFAULT });
  });

  it("非法值夹紧而不报错——分页参数不该让整个请求失败", () => {
    expect(normalizePage({ limit: 0 })).toEqual({ offset: 0, limit: 1 });
    expect(normalizePage({ limit: -5 })).toEqual({ offset: 0, limit: 1 });
    expect(normalizePage({ limit: 9999 })).toEqual({ offset: 0, limit: PAGE_LIMIT_MAX });
    expect(normalizePage({ offset: -1 })).toEqual({ offset: 0, limit: PAGE_LIMIT_DEFAULT });
    expect(normalizePage({ offset: 999999 })).toEqual({
      offset: PAGE_OFFSET_MAX,
      limit: PAGE_LIMIT_DEFAULT,
    });
  });

  it("小数取整，NaN 回落默认", () => {
    expect(normalizePage({ limit: 10.9 }).limit).toBe(10);
    expect(normalizePage({ offset: 3.7 }).offset).toBe(3);
    expect(normalizePage({ limit: Number.NaN }).limit).toBe(PAGE_LIMIT_DEFAULT);
    expect(normalizePage({ offset: Number.NaN }).offset).toBe(0);
  });
});

describe("pageResult", () => {
  it("nextOffset 按已取条数推进，取完为 null", () => {
    const mid = pageResult(["a", "b"], 5, 0, 2);
    expect(mid.nextOffset).toBe(2);

    const tail = pageResult(["e"], 5, 4, 2);
    expect(tail.nextOffset).toBeNull();
  });

  it("空结果集 nextOffset 为 null", () => {
    expect(pageResult([], 0, 0, 50).nextOffset).toBeNull();
  });

  it("回显入参的 offset/limit 与总数", () => {
    const page = pageResult([1, 2, 3], 10, 3, 3);
    expect(page).toEqual({ items: [1, 2, 3], total: 10, offset: 3, limit: 3, nextOffset: 6 });
  });
});
