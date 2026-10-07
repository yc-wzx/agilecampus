import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { deliverables, deliverableVersions, milestones, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createDeliverableDraft, updateDeliverableDraft, submitDeliverable, listProjectDeliverables, getDeliverableDetail } from "@/lib/deliverable";
import { resetDb } from "./helpers";

async function scene() {
  const [admin, student, peer, teacher, outsider] = await db.insert(users).values(
    ["admin", "student", "peer", "teacher", "outsider"].map((name) => ({
      name, email: `${name}@deliverable.test`, passwordHash: "fixture-not-a-login-password",
    })),
  ).returning();
  const team = await createTeam(admin.id, "D模块测试团队");
  for (const user of [student, peer, teacher]) await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "成果项目" });
  const other = await createProject(admin.id, team.id, { name: "同团队另一项目" });
  const milestone = await createMilestone(admin.id, project.id, { title: "第一次展示" });
  return { admin, student, peer, teacher, outsider, team, project, other, milestone };
}

function content() {
  return { title: "调研报告", type: "report" as const, url: "https://example.com/report", description: "首版说明", milestoneId: null };
}
async function draft(s: Awaited<ReturnType<typeof scene>>) {
  return createDeliverableDraft(s.student.id, s.project.id, { ...content(), requestId: randomUUID(), milestoneId: s.milestone.id });
}

describe("D / P0 deliverables (real PostgreSQL)", () => {
  beforeEach(resetDb);

  it("saves a draft, exposes allowed actions, and hides it from peers/teachers", async () => {
    const s = await scene(); const d = await draft(s);
    expect(d).toMatchObject({ status: "draft", revision: 1, authorId: s.student.id, milestoneId: s.milestone.id, allowedActions: { edit: true, submit: true } });
    expect(d).not.toHaveProperty("creationHash");
    expect(await listProjectDeliverables(s.student.id, s.project.id)).toHaveLength(1);
    expect(await listProjectDeliverables(s.admin.id, s.project.id)).toHaveLength(1);
    for (const user of [s.peer, s.teacher]) {
      expect(await listProjectDeliverables(user.id, s.project.id)).toEqual([]);
      await expect(getDeliverableDetail(user.id, s.project.id, d.id)).rejects.toThrow("没有权限");
    }
    expect((await getDeliverableDetail(s.student.id, s.project.id, d.id)).versions).toEqual([]);
  });

  it("permits title-only drafts but requires a URL before submission", async () => {
    const s = await scene();
    const d = await createDeliverableDraft(s.student.id, s.project.id, { title: "待补材料", type: "presentation", requestId: randomUUID() });
    await expect(submitDeliverable(s.student.id, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: d.revision })).rejects.toThrow("填写成果链接");
    expect((await getDeliverableDetail(s.student.id, s.project.id, d.id)).versions).toEqual([]);
  });

  it("checks membership and role on create/list/detail; does not trust authorship after leaving", async () => {
    const s = await scene(); const d = await draft(s);
    for (const user of [s.teacher, s.outsider]) {
      await expect(createDeliverableDraft(user.id, s.project.id, { ...content(), requestId: randomUUID() })).rejects.toThrow("没有权限");
    }
    await expect(listProjectDeliverables(s.outsider.id, s.project.id)).rejects.toThrow("没有权限");
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.student.id)));
    await expect(getDeliverableDetail(s.student.id, s.project.id, d.id)).rejects.toThrow("没有权限");
    await expect(updateDeliverableDraft(s.student.id, s.project.id, d.id, { ...content(), expectedRevision: 1 })).rejects.toThrow("没有权限");
    await expect(submitDeliverable(s.student.id, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: 1 })).rejects.toThrow("没有权限");
  });

  it("does not let another student or teacher edit/submit a draft; admin may assist", async () => {
    const s = await scene(); const d = await draft(s);
    for (const user of [s.peer, s.teacher, s.outsider]) {
      await expect(updateDeliverableDraft(user.id, s.project.id, d.id, { ...content(), expectedRevision: 1 })).rejects.toThrow("没有权限");
      await expect(submitDeliverable(user.id, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: 1 })).rejects.toThrow("没有权限");
    }
    const updated = await updateDeliverableDraft(s.admin.id, s.project.id, d.id, { ...content(), expectedRevision: 1, title: "协助修改" });
    const result = await submitDeliverable(s.admin.id, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: updated.revision });
    expect(result.deliverable.authorId).toBe(s.student.id);
    expect((await getDeliverableDetail(s.teacher.id, s.project.id, d.id)).versions[0].submittedById).toBe(s.admin.id);
  });

  it("rejects cross-project object IDs and milestones even inside the same team", async () => {
    const s = await scene(); const d = await draft(s);
    await expect(getDeliverableDetail(s.student.id, s.other.id, d.id)).rejects.toThrow("没有权限");
    await expect(updateDeliverableDraft(s.student.id, s.other.id, d.id, { ...content(), expectedRevision: 1 })).rejects.toThrow("没有权限");
    await expect(submitDeliverable(s.student.id, s.other.id, d.id, { requestId: randomUUID(), expectedRevision: 1 })).rejects.toThrow("没有权限");
    await expect(createDeliverableDraft(s.student.id, s.other.id, { ...content(), milestoneId: s.milestone.id, requestId: randomUUID() })).rejects.toThrow("里程碑不属于");
    const otherMilestone = await createMilestone(s.admin.id, s.other.id, { title: "其他项目" });
    await expect(updateDeliverableDraft(s.student.id, s.project.id, d.id, { ...content(), milestoneId: otherMilestone.id, expectedRevision: 1 })).rejects.toThrow("里程碑不属于");
  });

  it.each(["javascript:alert(1)", "data:text/html,evil", "file:///C:/secret", "//example.com", "https://user:pass@example.com", "https://exa\nmple.com"])("rejects unsafe URL %s", async (url) => {
    const s = await scene();
    await expect(createDeliverableDraft(s.student.id, s.project.id, { ...content(), url, requestId: randomUUID() })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects status/author/project injection and invalid or oversized content in the service itself", async () => {
    const s = await scene();
    for (const extra of [{ status: "submitted" }, { authorId: s.admin.id }, { projectId: s.other.id }, { title: " " }, { title: "x".repeat(201) }, { type: "invalid" }, { description: "x".repeat(10001) }]) {
      const input = { ...content(), requestId: randomUUID(), ...extra };
      await expect(createDeliverableDraft(s.student.id, s.project.id, input as Parameters<typeof createDeliverableDraft>[2])).rejects.toMatchObject({ code: "VALIDATION" });
    }
    const d = await draft(s);
    await expect(updateDeliverableDraft(s.student.id, s.project.id, d.id, { ...content(), expectedRevision: 1, status: "submitted" } as Parameters<typeof updateDeliverableDraft>[3])).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(getDeliverableDetail(s.student.id, s.project.id, "bad-id")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("deduplicates concurrent draft creation and rejects key reuse for different content", async () => {
    const s = await scene(); const input = { ...content(), requestId: randomUUID() };
    const [a, b] = await Promise.all([createDeliverableDraft(s.student.id, s.project.id, input), createDeliverableDraft(s.student.id, s.project.id, input)]);
    expect(a.id).toBe(b.id);
    expect(await listProjectDeliverables(s.student.id, s.project.id)).toHaveLength(1);
    await expect(createDeliverableDraft(s.student.id, s.project.id, { ...input, title: "换内容" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("prevents lost updates and refuses stale submission after a draft has changed", async () => {
    const s = await scene(); const d = await draft(s);
    const attempts = await Promise.allSettled(["甲", "乙"].map((title) => updateDeliverableDraft(s.student.id, s.project.id, d.id, { ...content(), title, expectedRevision: 1 })));
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
    await expect(submitDeliverable(s.student.id, s.project.id, d.id, { expectedRevision: 1, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await getDeliverableDetail(s.student.id, s.project.id, d.id)).deliverable.revision).toBe(2);
  });

  it("submits once under concurrency, keeps a snapshot, and makes it visible without edit permission", async () => {
    const s = await scene(); const d = await draft(s);
    const input = { expectedRevision: 1, requestId: randomUUID() };
    const results = await Promise.all([submitDeliverable(s.student.id, s.project.id, d.id, input), submitDeliverable(s.student.id, s.project.id, d.id, input)]);
    expect(results[0].versionId).toBe(results[1].versionId);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    for (const user of [s.student, s.peer, s.teacher, s.admin]) {
      const detail = await getDeliverableDetail(user.id, s.project.id, d.id);
      expect(detail.deliverable).toMatchObject({ status: "submitted", allowedActions: { edit: false, submit: false } });
      expect(detail.versions).toHaveLength(1);
      expect(detail.versions[0]).toMatchObject({ versionNumber: 1, title: d.title, url: d.url, milestoneTitle: "第一次展示" });
      expect(detail.versions[0]).not.toHaveProperty("submissionKey");
    }
    await expect(updateDeliverableDraft(s.student.id, s.project.id, d.id, { ...content(), expectedRevision: 2 })).rejects.toThrow("不能覆盖");
    await expect(submitDeliverable(s.student.id, s.project.id, d.id, { ...input, requestId: randomUUID() })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitDeliverable(s.student.id, s.project.id, d.id, { ...input, expectedRevision: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(submitDeliverable(s.peer.id, s.project.id, d.id, input)).rejects.toThrow("没有权限");
    await expect(getDeliverableDetail(s.outsider.id, s.project.id, d.id)).rejects.toThrow("没有权限");
  });

  it("allows only one effective submission even when concurrent requests use different keys", async () => {
    const s = await scene(); const d = await draft(s);
    const results = await Promise.allSettled([1, 2].map(() => submitDeliverable(s.student.id, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: 1 })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await getDeliverableDetail(s.student.id, s.project.id, d.id)).versions).toHaveLength(1);
  });

  it("keeps the submitted milestone snapshot even after the milestone is renamed/deleted", async () => {
    const s = await scene(); const d = await draft(s);
    await submitDeliverable(s.student.id, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: 1 });
    await db.update(milestones).set({ title: "改名" }).where(eq(milestones.id, s.milestone.id));
    await db.delete(milestones).where(eq(milestones.id, s.milestone.id));
    const detail = await getDeliverableDetail(s.teacher.id, s.project.id, d.id);
    expect(detail.deliverable.milestoneId).toBeNull();
    expect(detail.versions[0]).toMatchObject({ milestoneId: s.milestone.id, milestoneTitle: "第一次展示" });
  });

  it("rolls back the snapshot if the state update fails", async () => {
    const s = await scene(); const d = await draft(s);
    await db.execute(sql`ALTER TABLE deliverables ADD CONSTRAINT d_test_reject_submit CHECK (status <> 'submitted')`);
    try {
      await expect(submitDeliverable(s.student.id, s.project.id, d.id, { requestId: randomUUID(), expectedRevision: 1 })).rejects.toThrow();
      const [row] = await db.select().from(deliverables).where(eq(deliverables.id, d.id));
      expect(row.status).toBe("draft");
      expect(await db.select().from(deliverableVersions)).toHaveLength(0);
    } finally { await db.execute(sql`ALTER TABLE deliverables DROP CONSTRAINT d_test_reject_submit`); }
  });
});
