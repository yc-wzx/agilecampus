import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { projects, taskComments, tasks, teamMembers, users } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { getProjectForUser } from "./project";
import { normalizePage, pageResult } from "./pagination";
import { projectMutation } from "./project-mutation";
import { recordProjectActivity } from "./activity";
import { recordNotificationIntent } from "./notification";
import type { PageInput } from "@/contracts/p0-p2";
import { readProject } from "./project-read";

const createSchema = z.strictObject({
  requestId: z.uuid(),
  body: z.string().trim().min(1).max(10000),
  mentionedUserIds: z.array(z.uuid()).max(50),
});
const updateSchema = createSchema.extend({
  expectedRevision: z.number().int().positive(),
});
const deleteSchema = z.strictObject({
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
});
type Row = typeof taskComments.$inferSelect;
export async function getCommentPageOffset(
  actorId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  limit = 20,
) {
  z.uuid().parse(commentId);
  z.number().int().min(1).max(100).parse(limit);
  return readProject(actorId, projectId, async (tx) => {
    const [target] = await tx.execute<{ offset: number }>(
      sql`with ordered as(select id,row_number() over(order by created_at,id)-1 position from task_comments where project_id=${projectId} and task_id=${taskId} and deleted_at is null) select (floor(position::numeric/${limit})*${limit})::int as "offset" from ordered where id=${commentId}`,
    );
    return target?.offset ?? null;
  });
}
export type CommentItem = {
  id: string;
  projectId: string;
  taskId: string;
  authorId: string;
  authorName: string;
  body: string;
  mentionedUserIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};
async function dto(tx: typeof db | DbTx, row: Row): Promise<CommentItem> {
  const [user] = await tx
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.authorId));
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    authorId: row.authorId,
    authorName: user?.name ?? "已删除成员",
    body: row.body,
    mentionedUserIds: row.mentionedUserIds,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
async function requireTask(
  tx: typeof db | DbTx,
  projectId: string,
  taskId: string,
) {
  const [row] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
  if (!row) throw new NotFoundError("任务不存在");
}
async function mentions(
  tx: DbTx,
  actorId: string,
  projectId: string,
  ids: string[],
) {
  const unique = [...new Set(ids)].filter((id) => id !== actorId);
  if (!unique.length) return unique;
  const rows = await tx
    .select({ id: teamMembers.userId })
    .from(teamMembers)
    .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
    .where(and(eq(projects.id, projectId), inArray(teamMembers.userId, unique)))
    .for("share", { of: [teamMembers] });
  if (rows.length !== unique.length)
    throw new ForbiddenError("只能提及当前团队成员");
  return unique;
}
async function event(
  tx: DbTx,
  actorId: string,
  row: Row,
  type: "comment.created" | "comment.updated" | "comment.deleted",
  recipients: string[],
) {
  const eventKey =
    type === "comment.created"
      ? `${type}:${row.id}`
      : `${type}:${row.id}:${row.revision}`;
  const [task] = await tx
    .select({
      sprintId: tasks.sprintId,
      milestoneId: tasks.milestoneId,
      assigneeId: tasks.assigneeId,
      parentTaskId: tasks.parentTaskId,
    })
    .from(tasks)
    .where(eq(tasks.id, row.taskId));
  const [parent] = task?.parentTaskId
    ? await tx
        .select({ sprintId: tasks.sprintId })
        .from(tasks)
        .where(eq(tasks.id, task.parentTaskId))
    : [];
  await recordProjectActivity(tx, {
    eventKey,
    projectId: row.projectId,
    actorId,
    objectType: "comment",
    objectId: row.id,
    type,
    summary:
      type === "comment.deleted"
        ? "删除了任务评论"
        : type === "comment.created"
          ? "发表了任务评论"
          : "编辑了任务评论",
    occurredAt: row.updatedAt.toISOString(),
    metadata: {
      taskId: row.taskId,
      commentId: row.id,
      mentionedUserIds: recipients,
      revision: row.revision,
      milestoneId: task?.milestoneId ?? null,
      iterationId: parent?.sprintId ?? task?.sprintId ?? null,
      assigneeId: task?.assigneeId ?? null,
    },
  });
  if (recipients.length)
    await recordNotificationIntent(tx, {
      eventKey,
      projectId: row.projectId,
      actorId,
      type: "comment.mentioned",
      recipientIds: recipients,
      summary: "你在任务评论中被提及",
      sourceRef: {
        sourceKind: "comment",
        sourceId: row.id,
        projectId: row.projectId,
        sourceHref: `/projects/${row.projectId}?task=${row.taskId}&comment=${row.id}`,
        evidenceKey: `comment:${row.id}`,
        availability: "available",
      },
    });
}
export async function listTaskComments(
  actorId: string,
  projectId: string,
  taskId: string,
  paging: PageInput = {},
) {
  if (!(await getProjectForUser(actorId, projectId)))
    throw new ForbiddenError();
  await requireTask(db, projectId, taskId);
  const { offset, limit } = normalizePage(paging);
  const where = and(
    eq(taskComments.projectId, projectId),
    eq(taskComments.taskId, taskId),
    isNull(taskComments.deletedAt),
    sql`exists(select 1 from projects p join team_members m on p.team_id=m.team_id where p.id=${taskComments.projectId} and m.user_id=${actorId})`,
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(taskComments)
    .where(where);
  const rows = await db
    .select()
    .from(taskComments)
    .where(where)
    .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
    .limit(limit)
    .offset(offset);
  return pageResult(
    await Promise.all(rows.map((row) => dto(db, row))),
    count.total,
    offset,
    limit,
  );
}
export async function createTaskComment(
  actorId: string,
  projectId: string,
  taskId: string,
  input: z.input<typeof createSchema>,
) {
  const data = createSchema.parse(input);
  return projectMutation(
    {
      projectId,
      actorId,
      operation: "comment.create",
      requestId: data.requestId,
    },
    { taskId, ...data },
    ["admin", "teacher", "student"],
    async (tx) => {
      await requireTask(tx, projectId, taskId);
      const recipients = await mentions(
        tx,
        actorId,
        projectId,
        data.mentionedUserIds,
      );
      const [row] = await tx
        .insert(taskComments)
        .values({
          projectId,
          taskId,
          authorId: actorId,
          body: data.body,
          mentionedUserIds: recipients,
          notifiedUserIds: recipients,
        })
        .returning();
      await event(tx, actorId, row, "comment.created", recipients);
      return dto(tx, row);
    },
  );
}
export async function updateTaskComment(
  actorId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  input: z.input<typeof updateSchema>,
) {
  const data = updateSchema.parse(input);
  return projectMutation(
    {
      projectId,
      actorId,
      operation: "comment.update",
      requestId: data.requestId,
    },
    { taskId, commentId, ...data },
    ["admin", "teacher", "student"],
    async (tx, role) => {
      await requireTask(tx, projectId, taskId);
      const [old] = await tx
        .select()
        .from(taskComments)
        .where(
          and(
            eq(taskComments.id, commentId),
            eq(taskComments.projectId, projectId),
            eq(taskComments.taskId, taskId),
            isNull(taskComments.deletedAt),
          ),
        )
        .for("update");
      if (!old || (old.authorId !== actorId && role !== "admin"))
        throw new ForbiddenError();
      if (old.revision !== data.expectedRevision)
        throw new ConflictError("评论已被修改，请刷新");
      const mentioned = await mentions(
        tx,
        actorId,
        projectId,
        data.mentionedUserIds,
      );
      const recipients = mentioned.filter(
        (id) => !old.notifiedUserIds.includes(id),
      );
      const [row] = await tx
        .update(taskComments)
        .set({
          body: data.body,
          mentionedUserIds: mentioned,
          notifiedUserIds: [...old.notifiedUserIds, ...recipients],
          revision: old.revision + 1,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(taskComments.id, commentId))
        .returning();
      await event(tx, actorId, row, "comment.updated", recipients);
      return dto(tx, row);
    },
  );
}
export async function deleteTaskComment(
  actorId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  input: z.input<typeof deleteSchema>,
) {
  const data = deleteSchema.parse(input);
  return projectMutation(
    {
      projectId,
      actorId,
      operation: "comment.delete",
      requestId: data.requestId,
    },
    { taskId, commentId, ...data },
    ["admin", "teacher", "student"],
    async (tx, role) => {
      await requireTask(tx, projectId, taskId);
      const [old] = await tx
        .select()
        .from(taskComments)
        .where(
          and(
            eq(taskComments.id, commentId),
            eq(taskComments.projectId, projectId),
            eq(taskComments.taskId, taskId),
            isNull(taskComments.deletedAt),
          ),
        )
        .for("update");
      if (!old || (old.authorId !== actorId && role !== "admin"))
        throw new ForbiddenError();
      if (old.revision !== data.expectedRevision)
        throw new ConflictError("评论已被修改，请刷新");
      const [row] = await tx
        .update(taskComments)
        .set({
          body: "",
          mentionedUserIds: [],
          deletedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
          revision: old.revision + 1,
        })
        .where(eq(taskComments.id, commentId))
        .returning();
      await event(tx, actorId, row, "comment.deleted", []);
      return { commentId, deleted: true as const };
    },
  );
}
