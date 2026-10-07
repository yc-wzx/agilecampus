import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, deliverableFeedback, deliverableOutbox, feedbackTaskLinks, teamMembers, milestones, tasks } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { updateTask, deleteTask } from "@/lib/task";
import { createDeliverableDraft, submitDeliverable, startDeliverableRevision, updateDeliverableDraft, reviewDeliverable,
  getDeliverableDetail, listProjectDeliverables, addMilestoneFeedback, listProjectFeedback,
  createTaskFromFeedback, getFeedbackTaskLink, listTaskFeedback } from "@/lib/deliverable";
import { dispatchDeliverableEvents } from "@/lib/deliverable-events";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, peer, teacher, outsider] = await db.insert(users).values(["admin", "student", "peer", "teacher", "outsider"].map((name) => ({ name, email: `${name}@p1.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id, "P1测试");
  for (const u of [student, peer, teacher]) await joinTeam(u.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "教学项目" });
  const other = await createProject(admin.id, team.id, { name: "其他项目" });
  const milestone = await createMilestone(admin.id, project.id, { title: "中期" });
  const draft = await createDeliverableDraft(student.id, project.id, { requestId: randomUUID(), title: "第一版", type: "report", url: "https://example.com/v1", milestoneId: milestone.id });
  const submitted = await submitDeliverable(student.id, project.id, draft.id, { expectedRevision: draft.revision, requestId: randomUUID() });
  return { admin, student, peer, teacher, outsider, project, other, team, milestone, draft, submitted };
}
type Scene = Awaited<ReturnType<typeof scene>>;
async function reject(s: Scene) {
  return reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, { requestId: randomUUID(), versionId: s.submitted.versionId, decision: "changes_requested", comment: "补充访谈" });
}
async function resubmit(s: Scene, revision: number) {
  const started = await startDeliverableRevision(s.student.id, s.project.id, s.draft.id, { requestId: randomUUID(), expectedRevision: revision });
  const edited = await updateDeliverableDraft(s.student.id, s.project.id, s.draft.id, { title: "第二版", type: "report", url: "https://example.com/v2", milestoneId: s.milestone.id, expectedRevision: started.revision });
  return submitDeliverable(s.student.id, s.project.id, s.draft.id, { requestId: randomUUID(), expectedRevision: edited.revision });
}

describe("D P1 / PostgreSQL", () => {
  beforeEach(resetDb);

  it("rejects v1, resubmits v2, approves v2 and retains version-specific feedback", async () => {
    const s = await scene(); const rejected = await reject(s);
    const v2 = await resubmit(s, rejected.deliverable.revision);
    const approved = await reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, { requestId: randomUUID(), versionId: v2.versionId, decision: "approved" });
    expect(approved.deliverable.status).toBe("approved");
    const detail = await getDeliverableDetail(s.peer.id, s.project.id, s.draft.id);
    expect(detail.versions.map((v) => [v.versionNumber, v.url])).toEqual([[2, "https://example.com/v2"], [1, "https://example.com/v1"]]);
    expect(detail.feedback).toEqual(expect.arrayContaining([
      expect.objectContaining({ versionId: s.submitted.versionId, decision: "changes_requested", comment: "补充访谈" }),
      expect.objectContaining({ versionId: v2.versionId, decision: "approved", reviewerId: s.teacher.id }),
    ]));
    expect(detail.feedback[0]).not.toHaveProperty("requestHash");
  });

  it("keeps a private new draft separate from an approved version until explicit resubmission", async () => {
    const s = await scene();
    const approved = await reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, { requestId: randomUUID(), versionId: s.submitted.versionId, decision: "approved" });
    const input = { requestId: randomUUID(), expectedRevision: approved.deliverable.revision };
    const started = await startDeliverableRevision(s.student.id, s.project.id, s.draft.id, input);
    expect((await startDeliverableRevision(s.student.id, s.project.id, s.draft.id, input)).revision).toBe(started.revision);
    const edited = await updateDeliverableDraft(s.student.id, s.project.id, s.draft.id, { expectedRevision: started.revision, title: "私密新内容", type: "report", url: "https://example.com/private" });
    expect(edited.workingCopy?.title).toBe("私密新内容");
    expect(edited.status).toBe("approved");
    for (const u of [s.teacher, s.peer]) {
      const detail = await getDeliverableDetail(u.id, s.project.id, s.draft.id);
      expect(detail.deliverable).toMatchObject({ title: "第一版", url: "https://example.com/v1", workingCopy: null });
      expect(JSON.stringify(await listProjectDeliverables(u.id, s.project.id))).not.toContain("private");
      expect(detail.deliverable.allowedActions.edit).toBe(false);
    }
    const submitted = await submitDeliverable(s.student.id, s.project.id, s.draft.id, { expectedRevision: edited.revision, requestId: randomUUID() });
    expect(submitted.deliverable).toMatchObject({ status: "submitted", title: "私密新内容", workingCopy: null });
    expect((await getDeliverableDetail(s.teacher.id, s.project.id, s.draft.id)).versions[1].url).toBe("https://example.com/v1");
  });

  it("checks review roles, current membership, self-review and return comments", async () => {
    const s = await scene(); const input = { requestId: randomUUID(), versionId: s.submitted.versionId, decision: "approved" as const };
    for (const u of [s.student, s.peer, s.outsider]) await expect(reviewDeliverable(u.id, s.project.id, s.draft.id, input)).rejects.toThrow("没有权限");
    await expect(reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, { ...input, decision: "changes_requested", comment: " " })).rejects.toThrow("退回时必须");
    await updateMemberRole(s.admin.id, s.team.id, s.student.id, "teacher");
    await expect(reviewDeliverable(s.student.id, s.project.id, s.draft.id, input)).rejects.toThrow("自己的成果");
    await updateMemberRole(s.admin.id, s.team.id, s.teacher.id, "student");
    await expect(reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, input)).rejects.toThrow("没有权限");
    const approved = await reviewDeliverable(s.admin.id, s.project.id, s.draft.id, input);
    expect(approved.deliverable.status).toBe("approved");
  });

  it("serializes concurrent reviews and deduplicates repeated review requests/events", async () => {
    const s = await scene(); const input = { requestId: randomUUID(), versionId: s.submitted.versionId, decision: "approved" as const };
    const results = await Promise.all([reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, input), reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, input)]);
    expect(results[0].feedback.id).toBe(results[1].feedback.id);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect(await db.select().from(deliverableFeedback)).toHaveLength(1);
    expect(await db.select().from(deliverableOutbox)).toHaveLength(2);
    await expect(reviewDeliverable(s.admin.id, s.project.id, s.draft.id, { ...input, requestId: randomUUID(), decision: "changes_requested", comment: "不同意见" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, { ...input, comment: "换内容" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows only one decision when different reviewers submit at the same time", async () => {
    const s = await scene();
    const results = await Promise.allSettled([s.teacher, s.admin].map((u) => reviewDeliverable(u.id, s.project.id, s.draft.id, { requestId: randomUUID(), versionId: s.submitted.versionId, decision: "approved" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(deliverableFeedback)).toHaveLength(1);
  });

  it("rejects stale and cross-project version reviews after resubmission", async () => {
    const s = await scene(); const rejected = await reject(s); const v2 = await resubmit(s, rejected.deliverable.revision);
    const input = { requestId: randomUUID(), versionId: s.submitted.versionId, decision: "approved" as const };
    await expect(reviewDeliverable(s.teacher.id, s.project.id, s.draft.id, input)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(reviewDeliverable(s.teacher.id, s.other.id, s.draft.id, { ...input, versionId: v2.versionId })).rejects.toThrow("没有权限");
    expect((await getDeliverableDetail(s.teacher.id, s.project.id, s.draft.id)).deliverable.status).toBe("submitted");
  });

  it("rejects new drafts while pending review, from other users, or using a stale revision", async () => {
    const s = await scene(); const input = { requestId: randomUUID(), expectedRevision: s.submitted.deliverable.revision };
    await expect(startDeliverableRevision(s.student.id, s.project.id, s.draft.id, input)).rejects.toMatchObject({ code: "CONFLICT" });
    const rejected = await reject(s);
    await expect(startDeliverableRevision(s.student.id, s.project.id, s.draft.id, input)).rejects.toMatchObject({ code: "CONFLICT" });
    for (const u of [s.peer, s.teacher, s.outsider]) await expect(startDeliverableRevision(u.id, s.project.id, s.draft.id, { ...input, expectedRevision: rejected.deliverable.revision })).rejects.toThrow("没有权限");
  });

  it("saves teacher milestone feedback once and retains its title after milestone deletion", async () => {
    const s = await scene(); const input = { requestId: randomUUID(), comment: "中期需要补测" };
    const results = await Promise.all([addMilestoneFeedback(s.teacher.id, s.project.id, s.milestone.id, input), addMilestoneFeedback(s.teacher.id, s.project.id, s.milestone.id, input)]);
    expect(results[0].feedback.id).toBe(results[1].feedback.id);
    await expect(addMilestoneFeedback(s.student.id, s.project.id, s.milestone.id, input)).rejects.toThrow("没有权限");
    await expect(addMilestoneFeedback(s.teacher.id, s.other.id, s.milestone.id, input)).rejects.toThrow("里程碑不属于");
    await expect(addMilestoneFeedback(s.teacher.id, s.project.id, s.milestone.id, { ...input, comment: "篡改" })).rejects.toMatchObject({ code: "CONFLICT" });
    await db.delete(milestones).where(eq(milestones.id, s.milestone.id));
    expect(await listProjectFeedback(s.student.id, s.project.id)).toEqual([expect.objectContaining({ milestoneId: null, milestoneTitle: "中期", decision: "comment" })]);
    await expect(listProjectFeedback(s.outsider.id, s.project.id)).rejects.toThrow("没有权限");
  });

  it("creates one task per feedback, links both ways, and does not auto-approve on task completion", async () => {
    const s = await scene(); const rejected = await reject(s);
    const input = { requestId: randomUUID(), title: "补做访谈", assigneeId: s.student.id, dueDate: "2026-10-10" };
    const results = await Promise.all([createTaskFromFeedback(s.student.id, s.project.id, rejected.feedback.id, input), createTaskFromFeedback(s.student.id, s.project.id, rejected.feedback.id, input)]);
    expect(results[0].taskId).toBe(results[1].taskId);
    expect(await db.select().from(tasks)).toHaveLength(1);
    const taskId = results[0].taskId!;
    expect(await getFeedbackTaskLink(s.peer.id, s.project.id, rejected.feedback.id)).toMatchObject({ taskId, deleted: false });
    expect(await listTaskFeedback(s.teacher.id, s.project.id, taskId)).toEqual([expect.objectContaining({ id: rejected.feedback.id, versionId: s.submitted.versionId })]);
    await updateTask(s.student.id, taskId, { status: "done" });
    expect((await getDeliverableDetail(s.teacher.id, s.project.id, s.draft.id)).deliverable.status).toBe("changes_requested");
    expect(await createTaskFromFeedback(s.peer.id, s.project.id, rejected.feedback.id, { ...input, requestId: randomUUID() })).toMatchObject({ taskId, replayed: true });
  });

  it("enforces task-writing permissions, project boundaries, assignee membership and input validation", async () => {
    const s = await scene(); const rejected = await reject(s); const input = { requestId: randomUUID(), title: "修改" };
    for (const u of [s.teacher, s.outsider]) await expect(createTaskFromFeedback(u.id, s.project.id, rejected.feedback.id, input)).rejects.toThrow();
    await expect(createTaskFromFeedback(s.student.id, s.other.id, rejected.feedback.id, input)).rejects.toThrow("没有权限");
    await expect(createTaskFromFeedback(s.student.id, s.project.id, rejected.feedback.id, { ...input, assigneeId: s.outsider.id })).rejects.toThrow("负责人不是团队成员");
    await expect(createTaskFromFeedback(s.student.id, s.project.id, rejected.feedback.id, { ...input, dueDate: "2026-02-30" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("keeps a deleted-task tombstone instead of silently creating another task on retry", async () => {
    const s = await scene(); const rejected = await reject(s); const input = { requestId: randomUUID(), title: "修改" };
    const link = await createTaskFromFeedback(s.student.id, s.project.id, rejected.feedback.id, input);
    await deleteTask(s.student.id, link.taskId!);
    expect(await createTaskFromFeedback(s.student.id, s.project.id, rejected.feedback.id, input)).toMatchObject({ taskId: null, deleted: true, originalTaskId: link.taskId });
    await expect(createTaskFromFeedback(s.student.id, s.project.id, rejected.feedback.id, { ...input, title: "变更请求内容" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(tasks)).toHaveLength(0);
  });

  it("rolls back task creation when link storage fails", async () => {
    const s = await scene(); const rejected = await reject(s);
    await db.execute(sql`ALTER TABLE feedback_task_links ADD CONSTRAINT d_test_link_failure CHECK (false)`);
    try {
      await expect(createTaskFromFeedback(s.student.id, s.project.id, rejected.feedback.id, { requestId: randomUUID(), title: "修改" })).rejects.toThrow();
      expect(await db.select().from(tasks)).toHaveLength(0);
      expect(await db.select().from(feedbackTaskLinks)).toHaveLength(0);
      expect(await db.select().from(deliverableOutbox)).toHaveLength(2);
    } finally { await db.execute(sql`ALTER TABLE feedback_task_links DROP CONSTRAINT d_test_link_failure`); }
  });

  it("rolls back the decision and feedback when event persistence fails", async () => {
    const s = await scene();
    await db.execute(sql`ALTER TABLE deliverable_outbox ADD CONSTRAINT d_test_event_failure CHECK (type = 'deliverable.submitted')`);
    try {
      await expect(reject(s)).rejects.toThrow();
      expect(await db.select().from(deliverableFeedback)).toHaveLength(0);
      expect((await getDeliverableDetail(s.teacher.id, s.project.id, s.draft.id)).deliverable.status).toBe("submitted");
    } finally { await db.execute(sql`ALTER TABLE deliverable_outbox DROP CONSTRAINT d_test_event_failure`); }
  });

  it("retains failed handoffs for retry without rolling back committed reviews", async () => {
    const s = await scene(); await reject(s);
    expect(await dispatchDeliverableEvents(async () => { throw new Error("sink unavailable"); })).toEqual({ delivered: 0, failed: 2 });
    expect((await getDeliverableDetail(s.student.id, s.project.id, s.draft.id)).deliverable.status).toBe("changes_requested");
    const received = new Set<string>();
    expect(await dispatchDeliverableEvents(async (event) => { received.add(event.eventKey); })).toEqual({ delivered: 2, failed: 0 });
    expect(await dispatchDeliverableEvents(async (event) => { received.add(event.eventKey); })).toEqual({ delivered: 0, failed: 0 });
    expect(received.size).toBe(2);
  });

  it("concurrent dispatchers claim each event once and recheck revoked recipients", async () => {
    const s = await scene(); await reject(s);
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.student.id)));
    await updateMemberRole(s.admin.id, s.team.id, s.teacher.id, "student");
    const seen: { eventKey: string; type: string; recipientIds: string[] }[] = [];
    const dispatched = await Promise.all([1, 2].map(() => dispatchDeliverableEvents(async (event) => {
      seen.push(event);
    })));
    expect(dispatched.reduce((sum, r) => sum + r.failed, 0)).toBe(0);
    for (const event of seen) {
      expect(event.recipientIds).not.toContain(s.student.id);
      if (event.type === "deliverable.submitted") expect(event.recipientIds).not.toContain(s.teacher.id);
    }
    expect(seen).toHaveLength(2); expect(new Set(seen.map((e) => e.eventKey)).size).toBe(2);
    await expect(startDeliverableRevision(s.student.id, s.project.id, s.draft.id, { requestId: randomUUID(), expectedRevision: 3 })).rejects.toThrow("没有权限");
  });
});
