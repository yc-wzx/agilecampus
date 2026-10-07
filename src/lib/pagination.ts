import {
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PAGE_OFFSET_MAX,
  type PageInput,
  type PageResult,
} from "@/contracts/p0-p2";

// 分页纯函数：不碰数据库，便于单测，也供 task-contract / iteration 共用。
// 契约（§9.1）：offset ≥ 0，limit 为 1—100 默认 50，最大 offset 100000。

/** 把调用方传来的分页参数夹到合法区间。非法值夹紧而不报错——分页参数不该让整个请求失败。 */
export function normalizePage(input: PageInput = {}) {
  const rawLimit = Math.trunc(input.limit ?? PAGE_LIMIT_DEFAULT);
  const rawOffset = Math.trunc(input.offset ?? 0);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : PAGE_LIMIT_DEFAULT, 1), PAGE_LIMIT_MAX);
  const offset = Math.min(Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0), PAGE_OFFSET_MAX);
  return { offset, limit };
}

/**
 * 组装 PageResult。
 * nextOffset 以「已经取出多少条」为准（offset + items.length），不是 offset + limit——
 * 末尾不足一页时这样才不会给出一个永远取不到东西的 nextOffset。
 */
export function pageResult<T>(
  items: T[],
  total: number,
  offset: number,
  limit: number,
): PageResult<T> {
  const consumed = offset + items.length;
  return {
    items,
    total,
    offset,
    limit,
    nextOffset: consumed < total ? consumed : null,
  };
}
