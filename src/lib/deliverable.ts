import { createHash } from "node:crypto";
import { and, desc, eq, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { deliverables, deliverableVersions, deliverableTypeEnum, deliverableFeedback, feedbackTaskLinks, milestones, projects, teamMembers, tasks, type TeamRole } from "@/db/schema";
import { AppError, ForbiddenError } from "./errors";
import { getProjectForUser } from "./project";
import { createTask } from "./task";
import { recordDeliverableEvent } from "./deliverable-events";

export class DeliverableError extends AppError {
  constructor(public readonly code: "VALIDATION" | "CONFLICT", message: string) {
    super(message);
  }
}

const uuid = z.uuid("标识格式不正确");
const revision = z.number().int().positive().max(2147483646);
const safeUrl = z.string().trim().max(2048, "链接不能超过2048字").refine((value) => {
  if (!value) return true; // Drafts may omit the URL; submission may not.
  if (/[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}, "请填写完整的 HTTP 或 HTTPS 链接，不能包含账号密码");
const contentSchema = z.object({
  title: z.string().trim().min(1, "请填写成果标题").max(200, "标题不能超过200字"),
  type: z.enum(deliverableTypeEnum.enumValues),
  url: safeUrl.default(""),
  description: z.string().trim().max(10000, "说明不能超过10000字").default(""),
  milestoneId: uuid.nullable().default(null),
}).strict();
const createSchema = contentSchema.extend({ requestId: uuid }).strict();
const updateSchema = contentSchema.extend({ expectedRevision: revision }).strict();
const submitSchema = z.object({ requestId: uuid, expectedRevision: revision }).strict();
export type CreateDeliverableInput = z.input<typeof createSchema>;
export type UpdateDeliverableInput = z.input<typeof updateSchema>;
export type SubmitDeliverableInput = z.input<typeof submitSchema>;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new DeliverableError("VALIDATION", result.error.issues[0].message);
  return result.data;
}

type Deliverable = typeof deliverables.$inferSelect;
function view(row: Deliverable, actorId: string, role: TeamRole) {
  // Request metadata is internal; clients receive only business fields and allowed operations.
  const { creationKey, creationHash, workingCopy, ...data } = row;
  void creationKey; void creationHash;
  const writer = role === "admin" || (role === "student" && row.authorId === actorId);
  const canWrite = writer && (row.status === "draft" || workingCopy !== null);
  const privateCopy = workingCopy && (role === "admin" || row.authorId === actorId)
    ? { title: workingCopy.title, type: workingCopy.type, url: workingCopy.url, description: workingCopy.description, milestoneId: workingCopy.milestoneId } : null;
  return { ...data, workingCopy: privateCopy, allowedActions: {
    edit: canWrite, submit: canWrite,
    startRevision: writer && !workingCopy && ["approved", "changes_requested"].includes(row.status),
    review: row.status === "submitted" && role !== "student" && row.authorId !== actorId,
  } };
}

async function requireReadAccess(actorId: string, projectId: string) {
  parse(uuid, actorId); parse(uuid, projectId);
  const access = await getProjectForUser(actorId, projectId);
  if (!access) throw new ForbiddenError();
  return access;
}

// Same team-membership rule as getProjectForUser, with transactional locks so a role
// change/removal cannot race a write. Do not add a separate project-membership model.
async function lockAccess(tx: DbTx, actorId: string, projectId: string) {
  const [access] = await tx.select({ role: teamMembers.role })
    .from(projects).innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(and(eq(projects.id, projectId), eq(teamMembers.userId, actorId)))
    .for("share");
  if (!access) throw new ForbiddenError();
  return access;
}

async function checkMilestone(tx: DbTx, projectId: string, milestoneId: string | null) {
  if (!milestoneId) return null;
  const [row] = await tx.select().from(milestones)
    .where(and(eq(milestones.id, milestoneId), eq(milestones.projectId, projectId))).for("share");
  if (!row) throw new DeliverableError("VALIDATION", "里程碑不属于该项目");
  return row;
}

function requireWriter(row: Deliverable, actorId: string, role: TeamRole) {
  if (role !== "admin" && !(role === "student" && row.authorId === actorId)) throw new ForbiddenError();
}

async function lockDeliverable(tx: DbTx, projectId: string, deliverableId: string) {
  const [row] = await tx.select().from(deliverables)
    .where(and(eq(deliverables.id, deliverableId), eq(deliverables.projectId, projectId))).for("update");
  if (!row) throw new ForbiddenError(); // Do not disclose another project's object.
  return row;
}

export async function listProjectDeliverables(actorId: string, projectId: string) {
  const { role } = await requireReadAccess(actorId, projectId);
  const rows = await db.select().from(deliverables).where(and(
    eq(deliverables.projectId, projectId),
    role === "admin" ? undefined : or(ne(deliverables.status, "draft"), eq(deliverables.authorId, actorId)),
  )).orderBy(desc(deliverables.createdAt), desc(deliverables.id));
  return rows.map((row) => view(row, actorId, role));
}

export async function getDeliverableDetail(actorId: string, projectId: string, deliverableId: string) {
  parse(uuid, deliverableId);
  const { role } = await requireReadAccess(actorId, projectId);
  const [row] = await db.select().from(deliverables).where(and(
    eq(deliverables.id, deliverableId), eq(deliverables.projectId, projectId),
    role === "admin" ? undefined : or(ne(deliverables.status, "draft"), eq(deliverables.authorId, actorId)),
  ));
  if (!row) throw new ForbiddenError();
  const versions = await db.select().from(deliverableVersions)
    .where(eq(deliverableVersions.deliverableId, row.id)).orderBy(desc(deliverableVersions.versionNumber));
  const feedback = await db.select().from(deliverableFeedback).where(eq(deliverableFeedback.deliverableId, row.id)).orderBy(desc(deliverableFeedback.createdAt));
  return { deliverable: view(row, actorId, role), feedback: feedback.map(feedbackView), versions: versions.map(({ submissionKey, ...version }) => {
    void submissionKey; return version;
  }) };
}

export async function createDeliverableDraft(actorId: string, projectId: string, input: CreateDeliverableInput) {
  parse(uuid, actorId); parse(uuid, projectId);
  const { requestId, ...content } = parse(createSchema, input);
  const creationHash = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  return db.transaction(async (tx) => {
    const { role } = await lockAccess(tx, actorId, projectId);
    if (role !== "admin" && role !== "student") throw new ForbiddenError();
    await checkMilestone(tx, projectId, content.milestoneId);
    const [inserted] = await tx.insert(deliverables).values({
      ...content, authorId: actorId, projectId, creationKey: requestId, creationHash,
    }).onConflictDoNothing({ target: [deliverables.projectId, deliverables.authorId, deliverables.creationKey] }).returning();
    if (inserted) return view(inserted, actorId, role);
    const [existing] = await tx.select().from(deliverables).where(and(
      eq(deliverables.projectId, projectId), eq(deliverables.authorId, actorId), eq(deliverables.creationKey, requestId),
    ));
    if (!existing || existing.creationHash !== creationHash) throw new DeliverableError("CONFLICT", "同一请求标识不能用于不同草稿，请刷新后重试");
    return view(existing, actorId, role);
  });
}

export async function updateDeliverableDraft(actorId: string, projectId: string, deliverableId: string, input: UpdateDeliverableInput) {
  parse(uuid, actorId); parse(uuid, projectId); parse(uuid, deliverableId);
  const { expectedRevision, ...content } = parse(updateSchema, input);
  return db.transaction(async (tx) => {
    const { role } = await lockAccess(tx, actorId, projectId);
    const row = await lockDeliverable(tx, projectId, deliverableId);
    requireWriter(row, actorId, role);
    if (row.status !== "draft" && !row.workingCopy) throw new DeliverableError("CONFLICT", "成果已正式提交，不能覆盖提交内容；请先开始新版本草稿");
    if (row.revision !== expectedRevision) throw new DeliverableError("CONFLICT", "草稿已被更新，请刷新后确认最新内容");
    await checkMilestone(tx, projectId, content.milestoneId);
    const [updated] = await tx.update(deliverables).set({
      ...(row.workingCopy ? { workingCopy: { ...row.workingCopy, ...content } } : content),
      revision: row.revision + 1, updatedAt: new Date(),
    })
      .where(eq(deliverables.id, row.id)).returning();
    return view(updated, actorId, role);
  });
}

export async function submitDeliverable(actorId: string, projectId: string, deliverableId: string, input: SubmitDeliverableInput) {
  parse(uuid, actorId); parse(uuid, projectId); parse(uuid, deliverableId);
  const { requestId, expectedRevision } = parse(submitSchema, input);
  return db.transaction(async (tx) => {
    const { role } = await lockAccess(tx, actorId, projectId);
    const row = await lockDeliverable(tx, projectId, deliverableId);
    requireWriter(row, actorId, role);
    const [previous] = await tx.select().from(deliverableVersions).where(and(
      eq(deliverableVersions.deliverableId, row.id), eq(deliverableVersions.submissionKey, requestId),
    ));
    if (previous) {
      if (previous.draftRevision !== expectedRevision || previous.submittedById !== actorId) {
        throw new DeliverableError("CONFLICT", "提交请求与原请求不一致，请刷新后重试");
      }
      return { deliverable: view(row, actorId, role), versionId: previous.id, replayed: true };
    }
    if (row.status !== "draft" && !row.workingCopy) throw new DeliverableError("CONFLICT", "成果已提交，请刷新查看提交记录");
    if (row.revision !== expectedRevision) throw new DeliverableError("CONFLICT", "草稿已被更新，请刷新后确认再提交");
    const source = row.workingCopy ?? row;
    const content = parse(contentSchema, { title: source.title, type: source.type, url: source.url, description: source.description, milestoneId: source.milestoneId });
    if (!content.url) throw new DeliverableError("VALIDATION", "正式提交前请填写成果链接");
    const milestone = await checkMilestone(tx, projectId, content.milestoneId);
    const [latest] = await tx.select().from(deliverableVersions).where(eq(deliverableVersions.deliverableId, row.id)).orderBy(desc(deliverableVersions.versionNumber)).limit(1);
    const submittedAt = new Date();
    const [version] = await tx.insert(deliverableVersions).values({
      ...content, deliverableId: row.id, versionNumber: (latest?.versionNumber ?? 0) + 1,
      draftRevision: row.revision, submissionKey: requestId, authorId: row.authorId, submittedById: actorId,
      milestoneTitle: milestone?.title ?? null, submittedAt,
    }).returning();
    const [submitted] = await tx.update(deliverables).set({
      ...content, workingCopy: null, status: "submitted", revision: row.revision + 1, updatedAt: submittedAt, submittedAt,
    }).where(eq(deliverables.id, row.id)).returning();
    await recordDeliverableEvent(tx, { projectId, actorId, type: "deliverable.submitted",
      eventKey: `deliverable.submitted:${version.id}`, payload: { deliverableId: row.id, versionId: version.id }, recipients: "reviewers" });
    return { deliverable: view(submitted, actorId, role), versionId: version.id, replayed: false };
  });
}

type Feedback = typeof deliverableFeedback.$inferSelect;
function feedbackView(row: Feedback) {
  const { requestId, requestHash, ...data } = row;
  void requestId; void requestHash;
  return data;
}
function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const reviewSchema = z.object({
  requestId: uuid, versionId: uuid, decision: z.enum(["approved", "changes_requested"]),
  comment: z.string().trim().max(10000).default(""),
}).strict().refine((v) => v.decision !== "changes_requested" || !!v.comment, "退回时必须填写修改意见");
const milestoneFeedbackSchema = z.object({ requestId: uuid, comment: z.string().trim().min(1, "请填写反馈").max(10000) }).strict();
const feedbackTaskSchema = z.object({
  requestId: uuid, title: z.string().trim().min(1).max(200), description: z.string().trim().max(10000).optional(),
  assigneeId: uuid.optional(), dueDate: z.iso.date().optional(), priority: z.enum(["low", "medium", "high"]).default("medium"),
}).strict();
export type ReviewDeliverableInput = z.input<typeof reviewSchema>;
export type MilestoneFeedbackInput = z.input<typeof milestoneFeedbackSchema>;
export type FeedbackTaskInput = z.input<typeof feedbackTaskSchema>;

async function findFeedbackReplay(tx: DbTx, actorId: string, projectId: string, requestId: string, requestHash: string) {
  const [existing] = await tx.select().from(deliverableFeedback).where(and(
    eq(deliverableFeedback.projectId, projectId), eq(deliverableFeedback.reviewerId, actorId), eq(deliverableFeedback.requestId, requestId),
  ));
  if (existing && existing.requestHash !== requestHash) throw new DeliverableError("CONFLICT", "反馈请求标识已用于其他内容");
  return existing;
}

export async function startDeliverableRevision(actorId: string, projectId: string, deliverableId: string, input: SubmitDeliverableInput) {
  parse(uuid, actorId); parse(uuid, projectId); parse(uuid, deliverableId);
  const { requestId, expectedRevision } = parse(submitSchema, input);
  return db.transaction(async (tx) => {
    const { role } = await lockAccess(tx, actorId, projectId);
    const row = await lockDeliverable(tx, projectId, deliverableId);
    requireWriter(row, actorId, role);
    if (row.workingCopy?.requestId === requestId && row.workingCopy.baseRevision === expectedRevision) return view(row, actorId, role);
    if (row.workingCopy || row.revision !== expectedRevision || !["approved", "changes_requested"].includes(row.status)) {
      throw new DeliverableError("CONFLICT", "当前状态不能开始新版本，请刷新后确认");
    }
    const [updated] = await tx.update(deliverables).set({
      workingCopy: { title: row.title, type: row.type, url: row.url, description: row.description, milestoneId: row.milestoneId, requestId, baseRevision: expectedRevision },
      revision: row.revision + 1, updatedAt: new Date(),
    }).where(eq(deliverables.id, row.id)).returning();
    return view(updated, actorId, role);
  });
}

export async function reviewDeliverable(actorId: string, projectId: string, deliverableId: string, input: ReviewDeliverableInput) {
  parse(uuid, actorId); parse(uuid, projectId); parse(uuid, deliverableId);
  const data = parse(reviewSchema, input);
  const requestHash = hash({ deliverableId, ...data });
  return db.transaction(async (tx) => {
    const { role } = await lockAccess(tx, actorId, projectId);
    if (role === "student") throw new ForbiddenError();
    const row = await lockDeliverable(tx, projectId, deliverableId);
    if (row.authorId === actorId) throw new ForbiddenError("不能验收自己的成果");
    const replay = await findFeedbackReplay(tx, actorId, projectId, data.requestId, requestHash);
    if (replay) return { feedback: feedbackView(replay), deliverable: view(row, actorId, role), replayed: true };
    const [latest] = await tx.select().from(deliverableVersions).where(eq(deliverableVersions.deliverableId, row.id)).orderBy(desc(deliverableVersions.versionNumber)).limit(1);
    if (row.status !== "submitted" || latest?.id !== data.versionId) throw new DeliverableError("CONFLICT", "该版本已处理或不是当前待审版本，请刷新");
    const [feedback] = await tx.insert(deliverableFeedback).values({
      projectId, deliverableId, versionId: latest.id, milestoneId: row.milestoneId,
      milestoneTitle: latest.milestoneTitle, milestoneSnapshotId: latest.milestoneId,
      reviewerId: actorId, decision: data.decision,
      comment: data.comment, requestId: data.requestId, requestHash,
    }).onConflictDoNothing().returning();
    if (!feedback) throw new DeliverableError("CONFLICT", "该反馈请求或版本已被处理，请刷新");
    const [updated] = await tx.update(deliverables).set({ status: data.decision, revision: row.revision + 1, updatedAt: new Date() }).where(eq(deliverables.id, row.id)).returning();
    await recordDeliverableEvent(tx, { projectId, actorId, type: `deliverable.${data.decision}`,
      eventKey: `deliverable.reviewed:${feedback.id}`, payload: { deliverableId, versionId: latest.id, feedbackId: feedback.id, decision: data.decision }, recipients: [row.authorId] });
    return { feedback: feedbackView(feedback), deliverable: view(updated, actorId, role), replayed: false };
  });
}

export async function addMilestoneFeedback(actorId: string, projectId: string, milestoneId: string, input: MilestoneFeedbackInput) {
  parse(uuid, actorId); parse(uuid, projectId); parse(uuid, milestoneId);
  const data = parse(milestoneFeedbackSchema, input); const requestHash = hash({ milestoneId, ...data });
  return db.transaction(async (tx) => {
    const { role } = await lockAccess(tx, actorId, projectId);
    if (role === "student") throw new ForbiddenError();
    const milestone = await checkMilestone(tx, projectId, milestoneId);
    const replay = await findFeedbackReplay(tx, actorId, projectId, data.requestId, requestHash);
    if (replay) return { feedback: feedbackView(replay), replayed: true };
    const [inserted] = await tx.insert(deliverableFeedback).values({ projectId, milestoneId,
      milestoneTitle: milestone!.title, milestoneSnapshotId: milestoneId,
      reviewerId: actorId, decision: "comment", comment: data.comment,
      requestId: data.requestId, requestHash,
    }).onConflictDoNothing().returning();
    if (!inserted) {
      const previous = await findFeedbackReplay(tx, actorId, projectId, data.requestId, requestHash);
      if (!previous) throw new DeliverableError("CONFLICT", "反馈已更新，请刷新");
      return { feedback: feedbackView(previous), replayed: true };
    }
    await recordDeliverableEvent(tx, { projectId, actorId, type: "milestone.feedback",
      eventKey: `milestone.feedback:${inserted.id}`, payload: { milestoneId, feedbackId: inserted.id }, recipients: "members" });
    return { feedback: feedbackView(inserted), replayed: false };
  });
}

export async function listProjectFeedback(actorId: string, projectId: string) {
  await requireReadAccess(actorId, projectId);
  const rows = await db.select().from(deliverableFeedback).where(eq(deliverableFeedback.projectId, projectId)).orderBy(desc(deliverableFeedback.createdAt));
  return rows.map(feedbackView);
}

export async function getFeedbackTaskLink(actorId: string, projectId: string, feedbackId: string) {
  parse(uuid, feedbackId); await requireReadAccess(actorId, projectId);
  const [feedback] = await db.select().from(deliverableFeedback).where(and(eq(deliverableFeedback.id, feedbackId), eq(deliverableFeedback.projectId, projectId)));
  if (!feedback) throw new ForbiddenError();
  const [link] = await db.select().from(feedbackTaskLinks).where(eq(feedbackTaskLinks.feedbackId, feedbackId));
  return link ? { feedbackId, taskId: link.taskId, originalTaskId: link.originalTaskId, deleted: !link.taskId } : null;
}

export async function listTaskFeedback(actorId: string, projectId: string, taskId: string) {
  parse(uuid, taskId); await requireReadAccess(actorId, projectId);
  const [task] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)));
  if (!task) throw new ForbiddenError();
  const rows = await db.select({ feedback: deliverableFeedback }).from(feedbackTaskLinks)
    .innerJoin(deliverableFeedback, eq(deliverableFeedback.id, feedbackTaskLinks.feedbackId))
    .where(and(eq(feedbackTaskLinks.taskId, taskId), eq(deliverableFeedback.projectId, projectId)));
  return rows.map((r) => feedbackView(r.feedback));
}

export async function createTaskFromFeedback(actorId: string, projectId: string, feedbackId: string, input: FeedbackTaskInput) {
  parse(uuid, actorId); parse(uuid, projectId); parse(uuid, feedbackId);
  const { requestId, ...content } = parse(feedbackTaskSchema, input); const requestHash = hash(content);
  return db.transaction(async (tx) => {
    const { role } = await lockAccess(tx, actorId, projectId);
    if (role === "teacher") throw new ForbiddenError("教师可写反馈，修改任务由学生或管理员确认创建");
    const [feedback] = await tx.select().from(deliverableFeedback).where(and(eq(deliverableFeedback.id, feedbackId), eq(deliverableFeedback.projectId, projectId))).for("update");
    if (!feedback) throw new ForbiddenError();
    const [existing] = await tx.select().from(feedbackTaskLinks).where(eq(feedbackTaskLinks.feedbackId, feedbackId));
    if (existing) {
      if (existing.requestId === requestId && (existing.requestHash !== requestHash || existing.createdById !== actorId)) throw new DeliverableError("CONFLICT", "修改任务请求与原请求不一致");
      return { feedbackId, taskId: existing.taskId, originalTaskId: existing.originalTaskId, replayed: true, deleted: !existing.taskId };
    }
    if (content.assigneeId) {
      const [member] = await tx.select({ id: teamMembers.id }).from(teamMembers).innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
        .where(and(eq(projects.id, projectId), eq(teamMembers.userId, content.assigneeId))).for("share");
      if (!member) throw new DeliverableError("VALIDATION", "负责人不是团队成员");
    }
    if (feedback.milestoneId) await checkMilestone(tx, projectId, feedback.milestoneId);
    const task = await createTask(actorId, projectId, { ...content, description: content.description ?? feedback.comment,
      milestoneId: feedback.milestoneId ?? undefined,
    }, { tx });
    await tx.insert(feedbackTaskLinks).values({ feedbackId, taskId: task.id, originalTaskId: task.id, createdById: actorId, requestId, requestHash });
    await recordDeliverableEvent(tx, { projectId, actorId, type: "feedback.task_created",
      eventKey: `feedback.task_created:${feedbackId}`, payload: { feedbackId, taskId: task.id }, recipients: task.assigneeId ? [task.assigneeId] : [] });
    return { feedbackId, taskId: task.id, originalTaskId: task.id, replayed: false, deleted: false };
  });
}
