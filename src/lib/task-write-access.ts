import { sql } from "drizzle-orm";
import type { DbTx } from "@/db";
import { ForbiddenError } from "./errors";

/** 在写事务内锁定当前成员关系；撤销权限与请求重放遵循同一权限检查。 */
export async function lockTaskWriteAccess(tx: DbTx, actorId: string, projectId: string) {
  const rows = await tx.execute<{ role: string }>(sql`
    select m.role from projects p
    join team_members m on m.team_id = p.team_id
    where p.id = ${projectId} and m.user_id = ${actorId}
    for share of p, m
  `);
  if (!rows[0] || !["admin", "student"].includes(rows[0].role)) throw new ForbiddenError();
}
