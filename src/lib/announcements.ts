import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { announcements, projects, teamMembers } from "@/db/schema";
import type { AnnouncementItem, PageInput } from "@/contracts/p0-p2";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { getProjectForUser } from "./project";
import { normalizePage, pageResult } from "./pagination";
import { projectMutation } from "./project-mutation";
import { recordProjectActivity } from "./activity";
import { recordNotificationIntent } from "./notification";

const base = {
  requestId: z.uuid(),
  expectedRevision: z.number().int().positive(),
};
const publishSchema = z.strictObject({
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  isPinned: z.boolean(),
});
const editSchema = z
  .strictObject({
    ...base,
    title: publishSchema.shape.title.optional(),
    body: publishSchema.shape.body.optional(),
  })
  .refine(
    (d) => d.title !== undefined || d.body !== undefined,
    "请提供修改内容",
  );
const revisionSchema = z.strictObject(base);
const pinSchema = revisionSchema.extend({ isPinned: z.boolean() });
type Row = typeof announcements.$inferSelect;
function dto(row: Row): AnnouncementItem {
  return {
    ...row,
    status: row.status as AnnouncementItem["status"],
    publishedAt: row.publishedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
async function publication(
  tx: DbTx,
  actorId: string,
  row: Row,
  withdrawn = false,
) {
  const type = withdrawn ? "announcement.withdrawn" : "announcement.published";
  const eventKey = `${type}:${row.id}:${row.revision}`;
  await recordProjectActivity(tx, {
    eventKey,
    projectId: row.projectId,
    actorId,
    objectType: "announcement",
    objectId: row.id,
    type,
    summary: withdrawn ? "撤下了项目公告" : "发布了项目公告",
    occurredAt: row.updatedAt.toISOString(),
    metadata: { announcementId: row.id, revision: row.revision },
  });
  if (!withdrawn) {
    const members = await tx
      .select({ id: teamMembers.userId })
      .from(teamMembers)
      .innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
      .where(eq(projects.id, row.projectId));
    await recordNotificationIntent(tx, {
      eventKey,
      projectId: row.projectId,
      actorId,
      type,
      summary: `项目公告：${row.title}`,
      recipientIds: members.map((m) => m.id),
      sourceRef: {
        sourceKind: "announcement",
        sourceId: row.id,
        projectId: row.projectId,
        sourceHref: `/projects/${row.projectId}/announcements#announcement-${row.id}`,
        evidenceKey: `announcement:${row.id}:${row.revision}`,
        availability: "available",
      },
    });
  }
}
async function unpin(tx: DbTx, projectId: string, except?: string) {
  await tx
    .update(announcements)
    .set({
      isPinned: false,
      revision: sql`${announcements.revision} + 1`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(announcements.projectId, projectId),
        eq(announcements.isPinned, true),
        except ? ne(announcements.id, except) : undefined,
      ),
    );
}
export async function listProjectAnnouncements(
  actorId: string,
  projectId: string,
  filters: PageInput & { includeWithdrawn?: boolean } = {},
) {
  const data = z
    .strictObject({
      offset: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      includeWithdrawn: z.boolean().optional(),
    })
    .parse(filters);
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  if (data.includeWithdrawn && access.role === "student")
    throw new ForbiddenError();
  const { offset, limit } = normalizePage(data);
  const where = and(
    eq(announcements.projectId, projectId),
    data.includeWithdrawn ? undefined : eq(announcements.status, "published"),
    sql`exists(select 1 from projects p join team_members m on p.team_id=m.team_id where p.id=${announcements.projectId} and m.user_id=${actorId} and (${!data.includeWithdrawn} or m.role in ('teacher','admin')))`,
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(announcements)
    .where(where);
  const rows = await db
    .select()
    .from(announcements)
    .where(where)
    .orderBy(desc(announcements.publishedAt), announcements.id)
    .limit(limit)
    .offset(offset);
  return pageResult(rows.map(dto), count.total, offset, limit);
}
export async function getPinnedAnnouncement(
  actorId: string,
  projectId: string,
) {
  if (!(await getProjectForUser(actorId, projectId)))
    throw new ForbiddenError();
  const [row] = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.projectId, projectId),
        eq(announcements.status, "published"),
        eq(announcements.isPinned, true),
        sql`exists(select 1 from projects p join team_members m on p.team_id=m.team_id where p.id=${announcements.projectId} and m.user_id=${actorId})`,
      ),
    );
  return row ? dto(row) : null;
}
export async function publishAnnouncement(
  actorId: string,
  projectId: string,
  input: z.input<typeof publishSchema>,
) {
  const data = publishSchema.parse(input);
  return projectMutation(
    {
      projectId,
      actorId,
      operation: "announcement.publish",
      requestId: data.requestId,
    },
    data,
    ["admin", "teacher"],
    async (tx) => {
      if (data.isPinned) await unpin(tx, projectId);
      const [row] = await tx
        .insert(announcements)
        .values({
          projectId,
          authorId: actorId,
          title: data.title,
          body: data.body,
          isPinned: data.isPinned,
        })
        .returning();
      await publication(tx, actorId, row);
      return dto(row);
    },
  );
}
async function change(
  actorId: string,
  projectId: string,
  announcementId: string,
  operation: string,
  data: z.infer<typeof revisionSchema>,
  patch: (tx: DbTx, row: Row) => Promise<Partial<Row>>,
  event?: "withdraw" | "publish",
) {
  return projectMutation(
    {
      projectId,
      actorId,
      operation: `announcement.${operation}`,
      requestId: data.requestId,
    },
    { announcementId, ...data },
    ["teacher", "admin"],
    async (tx) => {
      const [old] = await tx
        .select()
        .from(announcements)
        .where(
          and(
            eq(announcements.id, announcementId),
            eq(announcements.projectId, projectId),
          ),
        )
        .for("update");
      if (!old) throw new NotFoundError("公告不存在");
      if (old.revision !== data.expectedRevision)
        throw new ConflictError("公告已变化，请刷新");
      const values = await patch(tx, old);
      const [row] = await tx
        .update(announcements)
        .set({
          ...values,
          revision: old.revision + 1,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(announcements.id, old.id))
        .returning();
      if (event) await publication(tx, actorId, row, event === "withdraw");
      return dto(row);
    },
  );
}
export async function updateAnnouncement(
  actorId: string,
  projectId: string,
  id: string,
  input: z.input<typeof editSchema>,
) {
  const data = editSchema.parse(input);
  return change(actorId, projectId, id, "update", data, async () => ({
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.body !== undefined ? { body: data.body } : {}),
  }));
}
export async function setAnnouncementPinned(
  actorId: string,
  projectId: string,
  id: string,
  input: z.input<typeof pinSchema>,
) {
  const data = pinSchema.parse(input);
  return change(actorId, projectId, id, "pin", data, async (tx, old) => {
    if (old.status !== "published")
      throw new ValidationError("撤下的公告不能置顶");
    if (data.isPinned) await unpin(tx, projectId, id);
    return { isPinned: data.isPinned };
  });
}
export async function withdrawAnnouncement(
  actorId: string,
  projectId: string,
  id: string,
  input: z.input<typeof revisionSchema>,
) {
  const data = revisionSchema.parse(input);
  return change(
    actorId,
    projectId,
    id,
    "withdraw",
    data,
    async (_tx, old) => {
      if (old.status !== "published") throw new ValidationError("公告已经撤下");
      return { status: "withdrawn", isPinned: false };
    },
    "withdraw",
  );
}
export async function republishAnnouncement(
  actorId: string,
  projectId: string,
  id: string,
  input: z.input<typeof revisionSchema>,
) {
  const data = revisionSchema.parse(input);
  return change(
    actorId,
    projectId,
    id,
    "republish",
    data,
    async () => ({ status: "published", publishedAt: new Date() }),
    "publish",
  );
}
