import { createHash } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import {
  projects,
  projectReferences,
  projectLeadChanges,
  teamMembers,
  users,
  milestones,
} from "@/db/schema";
import { AppError, ConflictError, ForbiddenError } from "./errors";
import { readProject } from "./project-read";
import {
  claimWriteRequest,
  finishWriteRequest,
  hashRequest,
  type WriteClaim,
} from "./write-request";

const uuid = z.uuid();
const revision = z.number().int().min(1).max(2147483646);
const link = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (/[\u0000-\u0020\u007f]/.test(value)) return false;
    try {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "请填写完整 HTTP/HTTPS 链接，不能包含账号密码");
const optionalLink = link.nullable().default(null);
const contentSchema = z
  .object({
    title: z.string().trim().min(1, "请填写名称").max(200),
    type: z.enum(["meeting", "document", "video", "prototype", "other"]),
    url: link,
    minutesUrl: optionalLink,
    recordingUrl: optionalLink,
    meetingDate: z.iso.date().nullable().default(null),
    participantIds: z
      .array(uuid)
      .max(100)
      .default([])
      .transform((ids) => [...new Set(ids)].sort()),
    milestoneId: uuid.nullable().default(null),
    note: z.string().trim().max(5000).default(""),
  })
  .strict();
const createSchema = contentSchema
  .extend({ requestId: uuid })
  .superRefine(checkMeeting);
const updateSchema = contentSchema
  .extend({ expectedRevision: revision, requestId: uuid.optional() })
  .superRefine(checkMeeting);
function checkMeeting(
  value: z.infer<typeof contentSchema>,
  context: z.RefinementCtx,
) {
  if (
    value.type !== "meeting" &&
    (value.minutesUrl ||
      value.recordingUrl ||
      value.meetingDate ||
      value.participantIds.length)
  ) {
    context.addIssue({
      code: "custom",
      message: "会议日期、参与人和纪要仅用于会议记录",
    });
  }
}
export type ReferenceInput = z.input<typeof createSchema>;
export type UpdateReferenceInput = z.input<typeof updateSchema>;
export type LeadInput = {
  leaderId: string | null;
  expectedRevision: number;
  requestId?: string;
};
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new AppError(result.error.issues[0].message);
  return result.data;
}

async function claim(
  tx: DbTx,
  actorId: string,
  projectId: string,
  operation: string,
  requestId: string | undefined,
  payload: unknown,
): Promise<WriteClaim | null> {
  return requestId
    ? claimWriteRequest(
        tx,
        { actorId, projectId, operation, requestId },
        hashRequest(payload),
      )
    : null;
}

async function access(
  tx: DbTx,
  actorId: string,
  projectId: string,
  write = false,
  lockProject = write,
) {
  if (!uuid.safeParse(actorId).success || !uuid.safeParse(projectId).success)
    throw new ForbiddenError();
  const projectQuery = tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  const [project] = await (lockProject
    ? projectQuery.for("share")
    : projectQuery);
  if (!project) throw new ForbiddenError();
  const query = tx
    .select()
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.teamId, project.teamId),
        eq(teamMembers.userId, actorId),
      ),
    );
  const [member] = await (write ? query.for("share") : query);
  if (!member) throw new ForbiddenError();
  if (write && project.status === "archived")
    throw new AppError("项目已归档，不能修改");
  return { project, role: member.role };
}

async function related(
  tx: DbTx,
  projectId: string,
  teamId: string,
  value: z.infer<typeof contentSchema>,
) {
  let milestoneTitle: string | null = null;
  if (value.milestoneId) {
    const [milestone] = await tx
      .select()
      .from(milestones)
      .where(
        and(
          eq(milestones.id, value.milestoneId),
          eq(milestones.projectId, projectId),
        ),
      )
      .for("share");
    if (!milestone) throw new AppError("阶段不属于当前项目");
    milestoneTitle = milestone.title;
  }
  const participants = value.participantIds.length
    ? await tx
        .select({ id: users.id, name: users.name })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(
          and(
            eq(teamMembers.teamId, teamId),
            inArray(teamMembers.userId, value.participantIds),
          ),
        )
        .for("share", { of: teamMembers })
    : [];
  if (participants.length !== value.participantIds.length)
    throw new AppError("参与人必须是当前团队成员");
  const { participantIds, ...fields } = value;
  void participantIds;
  return {
    ...fields,
    milestoneTitle,
    participants: participants.sort((a, b) => a.id.localeCompare(b.id)),
  };
}
function referenceView(
  row: typeof projectReferences.$inferSelect,
  actorId: string,
  role: string,
  archived: boolean,
) {
  const { requestId, requestHash, ...data } = row;
  void requestId;
  void requestHash;
  return {
    ...data,
    canEdit: !archived && (role === "admin" || row.createdById === actorId),
  };
}

export async function createProjectReference(
  actorId: string,
  projectId: string,
  input: ReferenceInput,
) {
  const { requestId, ...value } = parse(createSchema, input);
  const hash = createHash("sha256")
    .update(JSON.stringify({ actorId, projectId, ...value }))
    .digest("hex");
  return db.transaction(async (tx) => {
    const { project, role } = await access(tx, actorId, projectId, true);
    const request = await claim(
      tx,
      actorId,
      projectId,
      "reference.create",
      requestId,
      value,
    );
    if (request?.replay) {
      const id = (request.result as { id: string }).id;
      const [row] = await tx
        .select()
        .from(projectReferences)
        .where(
          and(
            eq(projectReferences.id, id),
            eq(projectReferences.projectId, projectId),
          ),
        )
        .for("share");
      if (!row) throw new ConflictError("记录已删除，请使用新请求重新创建");
      return referenceView(row, actorId, role, false);
    }
    const fields = await related(tx, projectId, project.teamId, value);
    const [created] = await tx
      .insert(projectReferences)
      .values({
        ...fields,
        projectId,
        createdById: actorId,
        requestId,
        requestHash: hash,
      })
      .onConflictDoNothing({ target: projectReferences.requestId })
      .returning();
    if (created) {
      if (request && !request.replay)
        await finishWriteRequest(tx, request.id, { id: created.id });
      return referenceView(created, actorId, role, false);
    }
    const [prior] = await tx
      .select()
      .from(projectReferences)
      .where(eq(projectReferences.requestId, requestId));
    if (!prior || prior.projectId !== projectId || prior.requestHash !== hash)
      throw new ConflictError("保存请求已使用，请刷新后重试");
    if (request && !request.replay)
      await finishWriteRequest(tx, request.id, { id: prior.id });
    return referenceView(prior, actorId, role, false);
  });
}

export async function updateProjectReference(
  actorId: string,
  projectId: string,
  id: string,
  input: UpdateReferenceInput,
) {
  parse(uuid, id);
  const { expectedRevision, requestId, ...value } = parse(updateSchema, input);
  return db.transaction(async (tx) => {
    const { project, role } = await access(tx, actorId, projectId, true);
    const [row] = await tx
      .select()
      .from(projectReferences)
      .where(
        and(
          eq(projectReferences.id, id),
          eq(projectReferences.projectId, projectId),
        ),
      )
      .for("update");
    if (!row || (role !== "admin" && row.createdById !== actorId))
      throw new ForbiddenError();
    const request = await claim(
      tx,
      actorId,
      projectId,
      "reference.update",
      requestId,
      { id, expectedRevision, ...value },
    );
    if (request?.replay) return referenceView(row, actorId, role, false);
    if (row.revision !== expectedRevision)
      throw new ConflictError("记录已被更新，请刷新后重试");
    const fields = await related(tx, projectId, project.teamId, value);
    const [updated] = await tx
      .update(projectReferences)
      .set({ ...fields, revision: row.revision + 1, updatedAt: new Date() })
      .where(eq(projectReferences.id, id))
      .returning();
    if (request && !request.replay)
      await finishWriteRequest(tx, request.id, { id });
    return referenceView(updated, actorId, role, false);
  });
}

export async function deleteProjectReference(
  actorId: string,
  projectId: string,
  id: string,
  expectedRevision: number,
  requestId?: string,
) {
  parse(uuid, id);
  parse(revision, expectedRevision);
  if (requestId !== undefined) parse(uuid, requestId);
  return db.transaction(async (tx) => {
    const { role } = await access(tx, actorId, projectId, true);
    const request = await claim(
      tx,
      actorId,
      projectId,
      "reference.delete",
      requestId,
      { id, expectedRevision },
    );
    if (request?.replay) {
      const prior = request.result as { createdById: string | null };
      if (role !== "admin" && prior.createdById !== actorId)
        throw new ForbiddenError();
      return;
    }
    const [row] = await tx
      .select()
      .from(projectReferences)
      .where(
        and(
          eq(projectReferences.id, id),
          eq(projectReferences.projectId, projectId),
        ),
      )
      .for("update");
    if (!row || (role !== "admin" && row.createdById !== actorId))
      throw new ForbiddenError();
    if (row.revision !== expectedRevision)
      throw new ConflictError("记录已被更新，请刷新后重试");
    await tx.delete(projectReferences).where(eq(projectReferences.id, id));
    if (request && !request.replay)
      await finishWriteRequest(tx, request.id, {
        id,
        deleted: true,
        createdById: row.createdById,
      });
  });
}

export async function listProjectReferences(
  actorId: string,
  projectId: string,
  input: { offset?: number; type?: string } = {},
) {
  const options = parse(
    z
      .object({
        offset: z.number().int().min(0).max(100000).default(0),
        type: z
          .enum(["meeting", "document", "video", "prototype", "other"])
          .optional(),
      })
      .strict(),
    input,
  );
  return readProject(actorId, projectId, async (tx) => {
    const { project, role } = await access(tx, actorId, projectId);
    const condition = and(
      eq(projectReferences.projectId, projectId),
      options.type ? eq(projectReferences.type, options.type) : undefined,
    );
    const rows = await tx
      .select()
      .from(projectReferences)
      .where(condition)
      .orderBy(desc(projectReferences.createdAt), desc(projectReferences.id))
      .limit(51)
      .offset(options.offset);
    return {
      items: rows
        .slice(0, 50)
        .map((r) =>
          referenceView(r, actorId, role, project.status === "archived"),
        ),
      offset: options.offset,
      nextOffset: rows.length > 50 ? options.offset + 50 : null,
    };
  });
}

export async function setProjectLeader(
  actorId: string,
  projectId: string,
  input: LeadInput,
) {
  const value = parse(
    z
      .object({
        leaderId: uuid.nullable(),
        expectedRevision: z.number().int().min(0).max(2147483646),
        requestId: uuid.optional(),
      })
      .strict(),
    input,
  );
  return db.transaction(async (tx) => {
    const { project, role } = await access(tx, actorId, projectId, true, false);
    if (role !== "admin") throw new ForbiddenError();
    const [locked] = await tx
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .for("update");
    if (locked.status === "archived")
      throw new AppError("项目已归档，不能修改");
    const request = await claim(
      tx,
      actorId,
      projectId,
      "project.leader",
      value.requestId,
      { leaderId: value.leaderId, expectedRevision: value.expectedRevision },
    );
    if (request?.replay)
      return request.result as { revision: number; changed: boolean };
    if (locked.leaderRevision !== value.expectedRevision)
      throw new ConflictError("负责人已被更新，请刷新后重试");
    let name: string | null = null;
    if (value.leaderId) {
      const [target] = await tx
        .select({ name: users.name })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(
          and(
            eq(teamMembers.teamId, project.teamId),
            eq(teamMembers.userId, value.leaderId),
          ),
        )
        .for("share", { of: teamMembers });
      if (!target) throw new AppError("负责人必须是当前团队成员");
      name = target.name;
    }
    if (locked.leaderId === value.leaderId) {
      const result = { revision: locked.leaderRevision, changed: false };
      return request && !request.replay
        ? finishWriteRequest(tx, request.id, result)
        : result;
    }
    const [actor] = await tx
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, actorId));
    const [old] = locked.leaderId
      ? await tx
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, locked.leaderId))
      : [];
    const next = locked.leaderRevision + 1;
    await tx
      .update(projects)
      .set({ leaderId: value.leaderId, leaderRevision: next })
      .where(eq(projects.id, projectId));
    await tx.insert(projectLeadChanges).values({
      projectId,
      actorId,
      actorName: actor.name,
      previousLeaderId: locked.leaderId,
      previousLeaderName: old?.name ?? null,
      leaderId: value.leaderId,
      leaderName: name,
      revision: next,
    });
    const result = { revision: next, changed: true };
    return request && !request.replay
      ? finishWriteRequest(tx, request.id, result)
      : result;
  });
}

export async function getProjectLeadership(actorId: string, projectId: string) {
  return readProject(actorId, projectId, async (tx) => {
    const { project } = await access(tx, actorId, projectId);
    const [leader] = project.leaderId
      ? await tx
          .select({ name: users.name, memberId: teamMembers.id })
          .from(users)
          .leftJoin(
            teamMembers,
            and(
              eq(teamMembers.userId, users.id),
              eq(teamMembers.teamId, project.teamId),
            ),
          )
          .where(eq(users.id, project.leaderId))
      : [];
    const changes = await tx
      .select()
      .from(projectLeadChanges)
      .where(eq(projectLeadChanges.projectId, projectId))
      .orderBy(desc(projectLeadChanges.revision))
      .limit(20);
    return {
      leaderId: project.leaderId,
      name: leader?.name ?? null,
      active: !!leader?.memberId,
      revision: project.leaderRevision,
      changes,
    };
  });
}
