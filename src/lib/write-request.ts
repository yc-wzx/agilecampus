import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DbTx } from "@/db";
import { writeRequests } from "@/db/schema";
import { lockTaskWriteAccess } from "./task-write-access";
import { ConflictError } from "./errors";

// C / P0：requestId 幂等。
//
// 契约（§9.1）：「新变更中使用 requestId 的操作都应保存服务端幂等凭据；相同标识与内容重放
// 返回原操作结果，相同标识配不同内容返回 CONFLICT。」
//
// 做法是「事务内先认领，再改动」：
//   1. 往 write_requests 插一行 (project, actor, operation, requestId) -> 唯一索引
//   2. 插进去了 = 首次请求，继续执行业务，最后把结果写回该行的 result
//   3. 没插进去 = 重放，读出原结果的哈希比对，一致就原样吐回
//
// 为什么必须先认领而不是先查后写：并发下两个相同 requestId 的请求会同时查不到记录然后各做一遍。
// 唯一索引让后来者在索引上等待，首个事务提交后它才失败并转入回放分支。
// 首个事务若回滚，认领也一并回滚，下一次重试是货真价实的首次请求。

export function hashRequest(payload: unknown): string {
  const serialized = JSON.stringify(payload, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
      : value,
  );
  return createHash("sha256").update(serialized ?? "null").digest("hex");
}

export type WriteRequestKey = {
  projectId: string;
  actorId: string;
  /** 操作标识，如 "task.create" / "iteration.start"。同 requestId 在不同操作下互不干扰。 */
  operation: string;
  requestId: string;
};

export type WriteClaim =
  | { replay: false; id: string }
  | { replay: true; result: unknown };

export async function claimWriteRequest(
  tx: DbTx,
  key: WriteRequestKey,
  requestHash: string,
): Promise<WriteClaim> {
  const [claimed] = await tx
    .insert(writeRequests)
    .values({ ...key, requestHash, result: null })
    .onConflictDoNothing({
      target: [
        writeRequests.projectId,
        writeRequests.actorId,
        writeRequests.operation,
        writeRequests.requestId,
      ],
    })
    .returning({ id: writeRequests.id });

  if (claimed) return { replay: false, id: claimed.id };

  const [existing] = await tx
    .select()
    .from(writeRequests)
    .where(
      and(
        eq(writeRequests.projectId, key.projectId),
        eq(writeRequests.actorId, key.actorId),
        eq(writeRequests.operation, key.operation),
        eq(writeRequests.requestId, key.requestId),
      ),
    );

  // 认领失败但查不到，只可能是并发事务尚未提交后又被回滚——这种极小概率竞态当作冲突处理，
  // 让调用方刷新重试，好过在这里静默地重复执行一次写操作。
  if (!existing) throw new ConflictError("请求正在处理中，请刷新后重试");
  if (existing.requestHash !== requestHash) {
    throw new ConflictError("同一请求标识已用于不同内容，请刷新后重试");
  }
  return { replay: true, result: existing.result };
}

/** 首次请求成功后回填结果，供后续重放原样返回。 */
export async function finishWriteRequest<T>(tx: DbTx, id: string, result: T): Promise<T> {
  await tx
    .update(writeRequests)
    .set({ result: result as unknown })
    .where(eq(writeRequests.id, id));
  return result;
}

/**
 * 把「认领 -> 执行 -> 回填」这套样板收敛成一个入口，避免九个写操作各写一遍。
 * `run` 只在首次请求时执行。
 */
export async function runIdempotent<T>(
  tx: DbTx,
  key: WriteRequestKey,
  payload: unknown,
  run: () => Promise<T>,
): Promise<T> {
  await lockTaskWriteAccess(tx, key.actorId, key.projectId);
  const claim = await claimWriteRequest(tx, key, hashRequest(payload));
  if (claim.replay) return claim.result as T;
  return finishWriteRequest(tx, claim.id, await run());
}
