import { sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { ForbiddenError } from "./errors";
import {
  claimWriteRequest,
  finishWriteRequest,
  hashRequest,
} from "./write-request";
import type { WriteRequestKey } from "./write-request";

// Comments allow teachers; announcement writes require teacher/admin. Keep C task permissions intact.
export async function projectMutation<T>(
  key: WriteRequestKey,
  payload: unknown,
  roles: string[],
  run: (tx: DbTx, role: string) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    // Serialize pinning without acquiring an exclusive project lock against C's task locks.
    if (key.operation.startsWith("announcement."))
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${key.projectId}, 0))`,
      );
    const rows = await tx.execute<{ role: string }>(sql`
      select m.role from projects p join team_members m on m.team_id = p.team_id
      where p.id = ${key.projectId} and m.user_id = ${key.actorId} for share of p, m
    `);
    const role = rows[0]?.role;
    if (!role || !roles.includes(role)) throw new ForbiddenError();
    const claim = await claimWriteRequest(tx, key, hashRequest(payload));
    if (claim.replay) {
      if (key.operation.startsWith("comment.")) {
        const result = claim.result as { id?: string; commentId?: string };
        const [comment] = await tx.execute<{
          authorId: string;
          deleted: boolean;
        }>(
          sql`select author_id as "authorId", deleted_at is not null as deleted from task_comments where id=${result.id ?? result.commentId} and project_id=${key.projectId} for share`,
        );
        if (
          !comment ||
          (key.operation !== "comment.delete" && comment.deleted) ||
          (comment.authorId !== key.actorId && role !== "admin")
        )
          throw new ForbiddenError("评论已删除或操作权限已变化");
      }
      return claim.result as T;
    }
    return finishWriteRequest(tx, claim.id, await run(tx, role));
  });
}
