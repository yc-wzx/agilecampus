import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { deliverables, deliverableTypeEnum, projects, teamMembers } from "@/db/schema";
import { DeliverableError } from "./deliverable";
import { ForbiddenError } from "./errors";

const uuid = z.uuid("标识格式不正确");
const paging = { offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(100).default(50) };
const mySchema = z.object({ ...paging, projectId: uuid.optional(), includeArchived: z.boolean().default(false) }).strict();
const teacherSchema = z.object({ ...paging, includeArchived: z.boolean().default(false) }).strict();
const evidenceSchema = z.object({
  ...paging, kind: z.enum(["submission", "review", "milestone_feedback"]).optional(),
  authorId: uuid.optional(), actorId: uuid.optional(), milestoneId: uuid.optional(),
  type: z.enum(deliverableTypeEnum.enumValues).optional(),
  fromDate: z.iso.date().optional(), toDate: z.iso.date().optional(),
}).strict().refine((v) => !v.fromDate || !v.toDate || v.fromDate < v.toDate, "结束日期必须晚于开始日期（结束日不包含在内）");
export type MyRevisionOptions = z.input<typeof mySchema>;
export type TeacherStatsOptions = z.input<typeof teacherSchema>;
export type DeliverableEvidenceOptions = z.input<typeof evidenceSchema>;
export type EvidenceSourceKind = "submission" | "feedback";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DeliverableError("VALIDATION", result.error.issues[0].message);
  return result.data;
}

const readSnapshot = { isolationLevel: "repeatable read", accessMode: "read only" } as const;
async function requireProject(tx: DbTx, actorId: string, projectId: string) {
  const [access] = await tx.select({ projectId: projects.id, projectStatus: projects.status, role: teamMembers.role })
    .from(projects).innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(and(eq(projects.id, projectId), eq(teamMembers.userId, actorId)));
  if (!access) throw new ForbiddenError();
  return access;
}

function sourceHref(projectId: string, kind: EvidenceSourceKind, id: string) {
  return `/api/projects/${projectId}/deliverable-evidence/${kind}/${id}`;
}
function page<T>(items: T[], total: number, offset: number, limit: number) {
  return { items, total, offset, limit, nextOffset: offset + items.length < total ? offset + items.length : null };
}
function counts(submitted: number, changesRequested: number, approved: number) {
  const total = submitted + changesRequested + approved;
  return { byStatus: { submitted, changes_requested: changesRequested, approved }, total,
    approvedRatio: total ? approved / total : null, scope: "current-submitted-deliverables" as const };
}

// Only current deliverable rows count. Initial drafts and historical versions never
// contribute to the denominator, regardless of the caller's draft-reading privilege.
export async function getProjectDeliverableStats(actorId: string, projectId: string) {
  parse(uuid, actorId); parse(uuid, projectId);
  return db.transaction(async (tx) => {
    const access = await requireProject(tx, actorId, projectId);
    const rows = await tx.select({ status: deliverables.status, count: sql<number>`count(*)::int` })
      .from(deliverables).where(and(eq(deliverables.projectId, projectId), ne(deliverables.status, "draft"))).groupBy(deliverables.status);
    const count = (status: string) => rows.find((r) => r.status === status)?.count ?? 0;
    return { projectId, projectStatus: access.projectStatus, ...counts(count("submitted"), count("changes_requested"), count("approved")) };
  }, readSnapshot);
}

export async function listTeacherDeliverableStats(actorId: string, input: TeacherStatsOptions = {}) {
  parse(uuid, actorId); const options = parse(teacherSchema, input);
  return db.transaction(async (tx) => {
    const [teacher] = await tx.select({ id: teamMembers.id }).from(teamMembers)
      .where(and(eq(teamMembers.userId, actorId), inArray(teamMembers.role, ["teacher", "admin"]))).limit(1);
    if (!teacher) throw new ForbiddenError("仅当前团队教师或管理员可查看教师验收总览");
    const filter = and(eq(teamMembers.userId, actorId), inArray(teamMembers.role, ["teacher", "admin"]),
      options.includeArchived ? undefined : eq(projects.status, "active"));
    const [total] = await tx.select({ count: sql<number>`count(*)::int` }).from(projects)
      .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId)).where(filter);
    const rows = await tx.select({ projectId: projects.id, projectName: projects.name, projectStatus: projects.status,
      submitted: sql<number>`count(${deliverables.id}) filter (where ${deliverables.status} = 'submitted')::int`,
      changesRequested: sql<number>`count(${deliverables.id}) filter (where ${deliverables.status} = 'changes_requested')::int`,
      approved: sql<number>`count(${deliverables.id}) filter (where ${deliverables.status} = 'approved')::int`,
    }).from(projects).innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
      .leftJoin(deliverables, and(eq(deliverables.projectId, projects.id), ne(deliverables.status, "draft")))
      .where(filter).groupBy(projects.id, projects.name, projects.status).orderBy(asc(projects.id)).limit(options.limit).offset(options.offset);
    return page(rows.map((r) => ({ projectId: r.projectId, projectName: r.projectName, projectStatus: r.projectStatus,
      ...counts(r.submitted, r.changesRequested, r.approved) })), total.count, options.offset, options.limit);
  }, readSnapshot);
}

type RevisionRequiredRow = {
  id: string; projectId: string; projectName: string; projectStatus: "active" | "archived";
  title: string; type: string; authorId: string; versionId: string; versionNumber: number;
  feedbackId: string; comment: string; reviewedAt: string; reviewerId: string; submittedAt: string;
  hasWorkingCopy: boolean; canRevise: boolean;
};
export async function listMyRevisionRequiredDeliverables(actorId: string, input: MyRevisionOptions = {}) {
  parse(uuid, actorId); const options = parse(mySchema, input);
  return db.transaction(async (tx) => {
    if (options.projectId) await requireProject(tx, actorId, options.projectId);
    const from = sql`from deliverables d
      join projects p on p.id = d.project_id
      join team_members m on m.team_id = p.team_id and m.user_id = ${actorId}
      join lateral (select id, version_number, submitted_at from deliverable_versions
        where deliverable_id = d.id order by version_number desc limit 1) v on true
      join deliverable_feedback f on f.version_id = v.id and f.deliverable_id = d.id and f.project_id = p.id
      where d.author_id = ${actorId} and d.status = 'changes_requested' and f.decision = 'changes_requested'
      ${options.projectId ? sql`and p.id = ${options.projectId}` : sql``}
      ${options.includeArchived ? sql`` : sql`and p.status = 'active'`}`;
    const [total] = await tx.execute<{ count: number }>(sql`select count(*)::int as count ${from}`);
    const rows = await tx.execute<RevisionRequiredRow>(sql`select d.id, p.id as "projectId", p.name as "projectName", p.status as "projectStatus",
      d.title, d.type, d.author_id as "authorId", v.id as "versionId", v.version_number as "versionNumber", v.submitted_at as "submittedAt",
      f.id as "feedbackId", f.comment, f.created_at as "reviewedAt", f.reviewer_id as "reviewerId",
      (d.working_copy is not null) as "hasWorkingCopy", (m.role in ('admin', 'student')) as "canRevise"
      ${from} order by f.created_at desc, d.id asc limit ${options.limit} offset ${options.offset}`);
    return page(rows.map((r) => ({ ...r, reviewedAt: new Date(r.reviewedAt).toISOString(), submittedAt: new Date(r.submittedAt).toISOString(),
      sourceHref: sourceHref(r.projectId, "feedback", r.feedbackId) })), total.count, options.offset, options.limit);
  }, readSnapshot);
}

type EvidenceRow = {
  id: string; kind: "submission" | "review" | "milestone_feedback"; projectId: string;
  deliverableId: string | null; versionId: string | null; versionNumber: number | null;
  title: string; type: string | null; url: string | null; description: string | null;
  authorId: string | null; actorId: string; occurredAt: string;
  milestoneId: string | null; milestoneTitle: string | null; decision: string | null; comment: string | null;
};

// Select immutable public snapshots explicitly. Never SELECT d.* (private working copies,
// creation hashes and idempotency tokens must not enter evidence or AI/export inputs).
function evidenceCte(projectId: string) {
  return sql`with evidence as (
    select v.id, 'submission'::text as kind, d.project_id as "projectId", d.id as "deliverableId",
      v.id as "versionId", v.version_number as "versionNumber", v.title, v.type::text as type, v.url, v.description,
      v.author_id as "authorId", v.submitted_by_id as "actorId", v.submitted_at as "occurredAt",
      v.milestone_id as "milestoneId", v.milestone_title as "milestoneTitle", null::text as decision, null::text as comment
    from deliverable_versions v join deliverables d on d.id = v.deliverable_id
    where d.project_id = ${projectId} and d.status <> 'draft'
    union all
    select f.id, case when f.version_id is null then 'milestone_feedback' else 'review' end,
      f.project_id, f.deliverable_id, f.version_id, v.version_number,
      coalesce(v.title, f.milestone_title, '里程碑反馈'), v.type::text, v.url, null::text,
      v.author_id, f.reviewer_id, f.created_at,
      coalesce(f.milestone_snapshot_id, v.milestone_id, f.milestone_id), f.milestone_title, f.decision::text, f.comment
    from deliverable_feedback f
    left join deliverable_versions v on v.id = f.version_id and v.deliverable_id = f.deliverable_id
    left join deliverables d on d.id = v.deliverable_id and d.project_id = f.project_id
    where f.project_id = ${projectId} and (
      (f.version_id is null and f.deliverable_id is null and f.decision = 'comment')
      or (v.id is not null and d.status <> 'draft')
    )
  )`;
}
function evidenceView(row: EvidenceRow) {
  return { ...row, occurredAt: new Date(row.occurredAt).toISOString(), evidenceKey: `${row.kind}:${row.id}`,
    sourceHref: sourceHref(row.projectId, row.kind === "submission" ? "submission" : "feedback", row.id) };
}

export async function listDeliverableEvidence(actorId: string, projectId: string, input: DeliverableEvidenceOptions = {}) {
  parse(uuid, actorId); parse(uuid, projectId); const options = parse(evidenceSchema, input);
  return db.transaction(async (tx) => {
    await requireProject(tx, actorId, projectId);
    const filter = sql`where true
      ${options.kind ? sql`and e.kind = ${options.kind}` : sql``}
      ${options.authorId ? sql`and e."authorId" = ${options.authorId}` : sql``}
      ${options.actorId ? sql`and e."actorId" = ${options.actorId}` : sql``}
      ${options.milestoneId ? sql`and e."milestoneId" = ${options.milestoneId}` : sql``}
      ${options.type ? sql`and e.type = ${options.type}` : sql``}
      ${options.fromDate ? sql`and e."occurredAt" >= ${options.fromDate + "T00:00:00+08:00"}::timestamptz` : sql``}
      ${options.toDate ? sql`and e."occurredAt" < ${options.toDate + "T00:00:00+08:00"}::timestamptz` : sql``}`;
    const [total] = await tx.execute<{ count: number }>(sql`${evidenceCte(projectId)} select count(*)::int as count from evidence e ${filter}`);
    const rows = await tx.execute<EvidenceRow>(sql`${evidenceCte(projectId)} select e.* from evidence e ${filter}
      order by e."occurredAt" desc, e.kind asc, e.id asc limit ${options.limit} offset ${options.offset}`);
    return { ...page(rows.map(evidenceView), total.count, options.offset, options.limit), timezone: "Asia/Shanghai" as const };
  }, readSnapshot);
}

export async function getDeliverableEvidenceRecord(actorId: string, projectId: string, kind: EvidenceSourceKind, recordId: string) {
  parse(uuid, actorId); parse(uuid, projectId); parse(uuid, recordId); parse(z.enum(["submission", "feedback"]), kind);
  return db.transaction(async (tx) => {
    await requireProject(tx, actorId, projectId);
    const [row] = await tx.execute<EvidenceRow>(sql`${evidenceCte(projectId)} select e.* from evidence e
      where e.id = ${recordId} and ${kind === "submission" ? sql`e.kind = 'submission'` : sql`e.kind in ('review', 'milestone_feedback')`} limit 1`);
    if (!row) throw new ForbiddenError();
    return evidenceView(row);
  }, readSnapshot);
}
