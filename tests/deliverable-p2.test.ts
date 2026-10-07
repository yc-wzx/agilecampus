import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { users, teamMembers, milestones, deliverableVersions, deliverableFeedback, deliverableOutbox } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone, updateProject } from "@/lib/project";
import { createDeliverableDraft, submitDeliverable, reviewDeliverable, startDeliverableRevision, updateDeliverableDraft,
  getDeliverableDetail, addMilestoneFeedback } from "@/lib/deliverable";
import { getProjectDeliverableStats, listTeacherDeliverableStats, listMyRevisionRequiredDeliverables,
  listDeliverableEvidence, getDeliverableEvidenceRecord } from "@/lib/deliverable-reporting";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, peer, teacher, outsider] = await db.insert(users).values(["admin", "student", "peer", "teacher", "outsider"].map((name) => ({ name, email: `${name}@p2.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id, "P2测试");
  for (const u of [student, peer, teacher]) await joinTeam(u.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "课程项目" });
  const empty = await createProject(admin.id, team.id, { name: "空项目" });
  const milestone = await createMilestone(admin.id, project.id, { title: "第一阶段" });
  const otherTeam = await createTeam(outsider.id, "外队");
  await joinTeam(teacher.id, otherTeam.inviteCode); // teacher in first team, student in second.
  const other = await createProject(outsider.id, otherTeam.id, { name: "外队项目" });
  return { admin, student, peer, teacher, outsider, team, project, empty, milestone, other };
}
type Scene = Awaited<ReturnType<typeof scene>>;
async function submission(s: Scene, authorId = s.student.id, submitterId = authorId) {
  const d = await createDeliverableDraft(authorId, s.project.id, { title: "正式报告", type: "report", url: "https://example.com/v1", description: "公开说明", milestoneId: s.milestone.id, requestId: randomUUID() });
  const result = await submitDeliverable(submitterId, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: d.revision });
  return { d, result };
}
async function review(s: Scene, sub: Awaited<ReturnType<typeof submission>>, decision: "approved" | "changes_requested") {
  return reviewDeliverable(s.teacher.id, s.project.id, sub.d.id, { requestId: randomUUID(), versionId: sub.result.versionId, decision, comment: "教师意见" });
}

describe("D P2 reporting and permission audit / PostgreSQL", () => {
  beforeEach(resetDb);

  it("returns zero counts and null ratio without leaking initial drafts, including to admins", async () => {
    const s = await scene();
    await createDeliverableDraft(s.student.id, s.project.id, { title: "私有初稿", type: "report", requestId: randomUUID() });
    for (const u of [s.student, s.peer, s.teacher, s.admin]) {
      expect(await getProjectDeliverableStats(u.id, s.project.id)).toMatchObject({ total: 0, approvedRatio: null, byStatus: { submitted: 0, changes_requested: 0, approved: 0 } });
      expect((await listDeliverableEvidence(u.id, s.project.id)).items).toEqual([]);
    }
    expect((await listTeacherDeliverableStats(s.teacher.id)).items.find((p) => p.projectId === s.empty.id)?.total).toBe(0);
  });

  it("counts current deliverables once regardless of versions, feedback or private new drafts", async () => {
    const s = await scene(); const sub = await submission(s); const returned = await review(s, sub, "changes_requested");
    const copy = await startDeliverableRevision(s.student.id, s.project.id, sub.d.id, { expectedRevision: returned.deliverable.revision, requestId: randomUUID() });
    const second = await submitDeliverable(s.student.id, s.project.id, sub.d.id, { expectedRevision: copy.revision, requestId: randomUUID() });
    const passed = await reviewDeliverable(s.teacher.id, s.project.id, sub.d.id, { versionId: second.versionId, decision: "approved", requestId: randomUUID() });
    await startDeliverableRevision(s.student.id, s.project.id, sub.d.id, { expectedRevision: passed.deliverable.revision, requestId: randomUUID() });
    await submission(s); const returnedOther = await submission(s, s.peer.id); await review(s, returnedOther, "changes_requested");
    expect(await getProjectDeliverableStats(s.student.id, s.project.id)).toMatchObject({ total: 3, approvedRatio: 1 / 3, byStatus: { submitted: 1, changes_requested: 1, approved: 1 } });
    const mine = await listMyRevisionRequiredDeliverables(s.student.id);
    expect(mine.total).toBe(0); // Only the peer's deliverable needs changes.
  });

  it("lists only the current author's latest returned submission and clears it after resubmission", async () => {
    const s = await scene(); const mine = await submission(s, s.student.id, s.admin.id); const returned = await review(s, mine, "changes_requested");
    await review(s, await submission(s, s.peer.id), "changes_requested");
    const initial = await listMyRevisionRequiredDeliverables(s.student.id);
    expect(initial.items).toEqual([expect.objectContaining({ id: mine.d.id, feedbackId: returned.feedback.id, versionId: mine.result.versionId, hasWorkingCopy: false, canRevise: true })]);
    expect(initial.items[0].reviewedAt).toMatch(/Z$/);
    expect((await listMyRevisionRequiredDeliverables(s.admin.id)).total).toBe(0); // Assisted submission is not authorship.
    const copy = await startDeliverableRevision(s.student.id, s.project.id, mine.d.id, { expectedRevision: returned.deliverable.revision, requestId: randomUUID() });
    expect((await listMyRevisionRequiredDeliverables(s.student.id)).items[0].hasWorkingCopy).toBe(true);
    await submitDeliverable(s.student.id, s.project.id, mine.d.id, { expectedRevision: copy.revision, requestId: randomUUID() });
    expect((await listMyRevisionRequiredDeliverables(s.student.id)).items).toEqual([]);
  });

  it("keeps archived projects out of daily/teacher lists by default but allows explicit history queries", async () => {
    const s = await scene(); await review(s, await submission(s), "changes_requested");
    await updateProject(s.admin.id, s.project.id, { status: "archived" });
    expect((await listMyRevisionRequiredDeliverables(s.student.id)).total).toBe(0);
    expect((await listMyRevisionRequiredDeliverables(s.student.id, { includeArchived: true })).total).toBe(1);
    expect((await listTeacherDeliverableStats(s.teacher.id)).items.map((p) => p.projectId)).toEqual([s.empty.id]);
    expect((await listTeacherDeliverableStats(s.teacher.id, { includeArchived: true })).total).toBe(2);
    expect((await getProjectDeliverableStats(s.teacher.id, s.project.id)).projectStatus).toBe("archived");
    expect((await listDeliverableEvidence(s.teacher.id, s.project.id)).total).toBe(2);
  });

  it("scopes teacher statistics by each team's current role and paginates zero-result projects", async () => {
    const s = await scene();
    const first = await listTeacherDeliverableStats(s.teacher.id, { limit: 1 });
    const second = await listTeacherDeliverableStats(s.teacher.id, { limit: 1, offset: first.nextOffset! });
    expect(first.total).toBe(2); expect(second.nextOffset).toBeNull();
    expect(new Set([...first.items, ...second.items].map((p) => p.projectId))).toEqual(new Set([s.project.id, s.empty.id]));
    await expect(listTeacherDeliverableStats(s.student.id)).rejects.toThrow("教师或管理员");
    await updateMemberRole(s.admin.id, s.team.id, s.teacher.id, "student");
    await expect(listTeacherDeliverableStats(s.teacher.id)).rejects.toThrow("教师或管理员");
    // A student's authorized project overview still has public aggregate access.
    expect((await getProjectDeliverableStats(s.teacher.id, s.other.id)).total).toBe(0);
  });

  it("separates authorship from actual submission/review activity and supports explicit filters", async () => {
    const s = await scene(); const sub = await submission(s, s.student.id, s.admin.id); const feedback = await review(s, sub, "approved");
    const note = await addMilestoneFeedback(s.teacher.id, s.project.id, s.milestone.id, { comment: "阶段评价", requestId: randomUUID() });
    const evidence = await listDeliverableEvidence(s.peer.id, s.project.id);
    expect(evidence.total).toBe(3);
    expect(evidence.items.find((e) => e.kind === "submission")).toMatchObject({ authorId: s.student.id, actorId: s.admin.id, versionId: sub.result.versionId });
    expect(evidence.items.find((e) => e.id === feedback.feedback.id)).toMatchObject({ kind: "review", authorId: s.student.id, actorId: s.teacher.id });
    expect(evidence.items.find((e) => e.id === note.feedback.id)?.authorId).toBeNull();
    expect((await listDeliverableEvidence(s.teacher.id, s.project.id, { authorId: s.student.id })).total).toBe(2);
    expect((await listDeliverableEvidence(s.teacher.id, s.project.id, { actorId: s.student.id })).total).toBe(0);
    expect((await listDeliverableEvidence(s.teacher.id, s.project.id, { actorId: s.admin.id, kind: "submission", type: "report" })).total).toBe(1);
    expect(evidence.items.every((e) => e.occurredAt.endsWith("Z"))).toBe(true);
  });

  it("never includes private drafts, internal tokens or pending edits in evidence, even for admins", async () => {
    const s = await scene(); const sub = await submission(s); const passed = await review(s, sub, "approved");
    const copy = await startDeliverableRevision(s.student.id, s.project.id, sub.d.id, { expectedRevision: passed.deliverable.revision, requestId: randomUUID() });
    await updateDeliverableDraft(s.student.id, s.project.id, sub.d.id, { title: "PRIVATE_SECRET", type: "report", url: "https://example.com/PRIVATE_SECRET", description: "PRIVATE_SECRET", expectedRevision: copy.revision });
    const privateDraft = await createDeliverableDraft(s.student.id, s.project.id, { title: "PRIVATE_INITIAL", type: "video", requestId: randomUUID() });
    for (const u of [s.student, s.teacher, s.admin]) {
      const result = await listDeliverableEvidence(u.id, s.project.id);
      const text = JSON.stringify(result);
      for (const secret of ["PRIVATE_SECRET", "PRIVATE_INITIAL", "workingCopy", "requestId", "creationHash", "submissionKey"]) expect(text).not.toContain(secret);
      expect(result.items.find((e) => e.kind === "submission")?.url).toBe("https://example.com/v1");
      await expect(getDeliverableEvidenceRecord(u.id, s.project.id, "submission", privateDraft.id)).rejects.toThrow("没有权限");
    }
  });

  it("filters deleted milestone history using immutable IDs and preserves source links", async () => {
    const s = await scene(); const sub = await submission(s); await review(s, sub, "approved");
    await addMilestoneFeedback(s.teacher.id, s.project.id, s.milestone.id, { comment: "历史意见", requestId: randomUUID() });
    await db.delete(milestones).where(eq(milestones.id, s.milestone.id));
    const result = await listDeliverableEvidence(s.teacher.id, s.project.id, { milestoneId: s.milestone.id });
    expect(result.total).toBe(3);
    for (const item of result.items) {
      const kind = item.kind === "submission" ? "submission" : "feedback";
      expect(await getDeliverableEvidenceRecord(s.student.id, s.project.id, kind, item.id)).toEqual(item);
      expect(item.sourceHref).toBe(`/api/projects/${s.project.id}/deliverable-evidence/${kind}/${item.id}`);
      expect(item.milestoneTitle).toBe("第一阶段");
    }
  });

  it("uses Shanghai day boundaries with an inclusive start and exclusive end", async () => {
    const s = await scene(); const sub = await submission(s); const feedback = await review(s, sub, "approved");
    await db.update(deliverableVersions).set({ submittedAt: new Date("2026-10-01T16:00:00.000Z") }).where(eq(deliverableVersions.id, sub.result.versionId));
    await db.update(deliverableFeedback).set({ createdAt: new Date("2026-10-02T16:00:00.000Z") }).where(eq(deliverableFeedback.id, feedback.feedback.id));
    const result = await listDeliverableEvidence(s.student.id, s.project.id, { fromDate: "2026-10-02", toDate: "2026-10-03" });
    expect(result.items.map((e) => e.kind)).toEqual(["submission"]);
    expect((await listDeliverableEvidence(s.student.id, s.project.id, { fromDate: "2026-10-03", toDate: "2026-10-04" })).items.map((e) => e.kind)).toEqual(["review"]);
  });

  it("paginates evidence with deterministic tie-breaking and an honest total/nextOffset", async () => {
    const s = await scene(); await submission(s);
    for (let i = 0; i < 5; i++) await addMilestoneFeedback(s.teacher.id, s.project.id, s.milestone.id, { comment: `意见${i}`, requestId: randomUUID() });
    await db.update(deliverableFeedback).set({ createdAt: new Date("2026-10-02T00:00:00Z") });
    await db.update(deliverableVersions).set({ submittedAt: new Date("2026-10-02T00:00:00Z") });
    const keys: string[] = []; let offset: number | null = 0;
    while (offset !== null) {
      const result = await listDeliverableEvidence(s.teacher.id, s.project.id, { offset, limit: 2 });
      expect(result.total).toBe(6); keys.push(...result.items.map((e) => e.evidenceKey)); offset = result.nextOffset;
    }
    expect(keys).toHaveLength(6); expect(new Set(keys).size).toBe(6);
    expect((await listDeliverableEvidence(s.teacher.id, s.project.id, { offset: 10 })).items).toEqual([]);
  });

  it("rejects unauthorized, revoked and cross-project source access without returning data", async () => {
    const s = await scene(); const sub = await submission(s); await review(s, sub, "changes_requested");
    for (const u of [s.outsider]) {
      await expect(getProjectDeliverableStats(u.id, s.project.id)).rejects.toThrow("没有权限");
      await expect(listDeliverableEvidence(u.id, s.project.id)).rejects.toThrow("没有权限");
      await expect(listMyRevisionRequiredDeliverables(u.id, { projectId: s.project.id })).rejects.toThrow("没有权限");
    }
    await expect(getDeliverableEvidenceRecord(s.teacher.id, s.empty.id, "submission", sub.result.versionId)).rejects.toThrow("没有权限");
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.student.id)));
    expect((await listMyRevisionRequiredDeliverables(s.student.id)).total).toBe(0);
    await expect(getDeliverableEvidenceRecord(s.student.id, s.project.id, "submission", sub.result.versionId)).rejects.toThrow("没有权限");
  });

  it("validates filters, limits, dates and rejects caller-supplied identity fields", async () => {
    const s = await scene();
    for (const input of [{ limit: 0 }, { limit: 101 }, { offset: -1 }, { fromDate: "2026-02-30" }, { fromDate: "2026-10-03", toDate: "2026-10-02" }, { actorId: "bad" }, { unknown: true }]) {
      await expect(listDeliverableEvidence(s.student.id, s.project.id, input)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    await expect(listMyRevisionRequiredDeliverables(s.student.id, { actorId: s.peer.id } as Parameters<typeof listMyRevisionRequiredDeliverables>[1])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(listTeacherDeliverableStats(s.teacher.id, { includeArchived: "true" } as unknown as Parameters<typeof listTeacherDeliverableStats>[1])).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps simultaneous edit/submit and reporting consistent with one effective write", async () => {
    const s = await scene();
    const d = await createDeliverableDraft(s.student.id, s.project.id, { title: "原内容", type: "report", url: "https://example.com/old", requestId: randomUUID() });
    const results = await Promise.allSettled([
      updateDeliverableDraft(s.student.id, s.project.id, d.id, { title: "新内容", type: "report", url: "https://example.com/new", expectedRevision: 1 }),
      submitDeliverable(s.student.id, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const detail = await getDeliverableDetail(s.student.id, s.project.id, d.id);
    const stats = await getProjectDeliverableStats(s.teacher.id, s.project.id);
    const evidence = await listDeliverableEvidence(s.teacher.id, s.project.id);
    expect(stats.total).toBe(detail.deliverable.status === "submitted" ? 1 : 0);
    expect(evidence.total).toBe(stats.total);
    if (detail.versions.length) expect(detail.versions[0].url).toBe("https://example.com/old");
  });

  it("backfills only provable P1 milestone identities, including deleted targets; unknown stays null", async () => {
    const s = await scene(); const sub = await submission(s); const reviewed = await review(s, sub, "approved");
    const note = await addMilestoneFeedback(s.teacher.id, s.project.id, s.milestone.id, { comment: "可追溯", requestId: randomUUID() });
    const unknown = await addMilestoneFeedback(s.teacher.id, s.project.id, s.milestone.id, { comment: "无历史来源", requestId: randomUUID() });
    await db.update(deliverableFeedback).set({ milestoneSnapshotId: null });
    await db.delete(milestones).where(eq(milestones.id, s.milestone.id));
    await db.update(deliverableOutbox).set({ payload: { feedbackId: unknown.feedback.id, milestoneId: "not-a-uuid" } }).where(eq(deliverableOutbox.eventKey, `milestone.feedback:${unknown.feedback.id}`));
    const before = await db.select().from(deliverableFeedback);
    const backfill = readFileSync("drizzle/0003_d_deliverables_p2.sql", "utf8").split("--> statement-breakpoint").slice(1);
    await db.transaction(async (tx) => { for (const statement of backfill) await tx.execute(sql.raw(statement)); });
    const after = await db.select().from(deliverableFeedback);
    expect(after.find((f) => f.id === reviewed.feedback.id)?.milestoneSnapshotId).toBe(s.milestone.id);
    expect(after.find((f) => f.id === note.feedback.id)?.milestoneSnapshotId).toBe(s.milestone.id);
    expect(after.find((f) => f.id === unknown.feedback.id)?.milestoneSnapshotId).toBeNull();
    for (const row of after) expect({ ...row, milestoneSnapshotId: null }).toEqual(before.find((f) => f.id === row.id));
  });
});
