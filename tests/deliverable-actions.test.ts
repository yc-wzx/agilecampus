import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { resetDb } from "./helpers";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { createDeliverableDraftAction, updateDeliverableDraftAction, submitDeliverableAction, listDeliverablesAction, getDeliverableAction,
  reviewDeliverableAction, startDeliverableRevisionAction, addMilestoneFeedbackAction,
  listProjectFeedbackAction, createTaskFromFeedbackAction, getFeedbackTaskLinkAction, listTaskFeedbackAction,
} from "@/app/(app)/projects/[projectId]/deliverables/actions";

describe("D Server Actions (real service/database; session and cache stubbed)", () => {
  beforeEach(async () => { vi.resetAllMocks(); await resetDb(); });

  it("rejects unauthenticated requests for every P0/P1 action", async () => {
    mocks.auth.mockResolvedValue(null);
    const projectId = randomUUID(); const id = randomUUID();
    const results = await Promise.all([
      listDeliverablesAction(projectId), getDeliverableAction(projectId, id),
      createDeliverableDraftAction(projectId, { title: "报告", type: "report", requestId: randomUUID() }),
      updateDeliverableDraftAction(projectId, id, { title: "报告", type: "report", expectedRevision: 1 }),
      submitDeliverableAction(projectId, id, { requestId: randomUUID(), expectedRevision: 1 }),
      startDeliverableRevisionAction(projectId, id, { requestId: randomUUID(), expectedRevision: 1 }),
      reviewDeliverableAction(projectId, id, { requestId: randomUUID(), versionId: randomUUID(), decision: "approved" }),
      addMilestoneFeedbackAction(projectId, id, { requestId: randomUUID(), comment: "反馈" }),
      listProjectFeedbackAction(projectId),
      createTaskFromFeedbackAction(projectId, id, { requestId: randomUUID(), title: "修改任务" }),
      getFeedbackTaskLinkAction(projectId, id), listTaskFeedbackAction(projectId, id),
    ]);
    for (const result of results) expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("runs the P1 review/revision/feedback/task flow through authenticated Actions", async () => {
    const [admin, student, teacher, outsider] = await db.insert(users).values(["admin", "student", "teacher", "outsider"].map((name) => ({ name, email: `${name}@p1-action.test`, passwordHash: "fixture" }))).returning();
    const team = await createTeam(admin.id, "P1接口");
    for (const u of [student, teacher]) await joinTeam(u.id, team.inviteCode);
    await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
    const project = await createProject(admin.id, team.id, { name: "P1接口项目" });
    const milestone = await createMilestone(admin.id, project.id, { title: "阶段展示" });
    mocks.auth.mockResolvedValue({ user: { id: student.id } });
    const created = await createDeliverableDraftAction(project.id, { title: "报告", type: "report", url: "https://example.com/v1", requestId: randomUUID() });
    if (!created.ok) throw new Error(created.error);
    const id = created.data.id;
    const first = await submitDeliverableAction(project.id, id, { expectedRevision: 1, requestId: randomUUID() });
    if (!first.ok) throw new Error(first.error);
    const reviewInput = { versionId: first.data.versionId, requestId: randomUUID(), decision: "changes_requested" as const, comment: "补充说明" };
    expect(await reviewDeliverableAction(project.id, id, reviewInput)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    mocks.auth.mockResolvedValue({ user: { id: teacher.id } });
    const reviewed = await reviewDeliverableAction(project.id, id, reviewInput);
    if (!reviewed.ok) throw new Error(reviewed.error);
    expect(await addMilestoneFeedbackAction(project.id, milestone.id, { requestId: randomUUID(), comment: "中期反馈" })).toMatchObject({ ok: true });
    expect(await listProjectFeedbackAction(project.id)).toMatchObject({ ok: true });
    mocks.auth.mockResolvedValue({ user: { id: student.id } });
    const task = await createTaskFromFeedbackAction(project.id, reviewed.data.feedback.id, { requestId: randomUUID(), title: "完善说明" });
    if (!task.ok || !task.data.taskId) throw new Error("Task creation failed");
    expect(await getFeedbackTaskLinkAction(project.id, reviewed.data.feedback.id)).toMatchObject({ ok: true, data: { taskId: task.data.taskId } });
    expect(await listTaskFeedbackAction(project.id, task.data.taskId)).toMatchObject({ ok: true, data: [{ id: reviewed.data.feedback.id }] });
    const started = await startDeliverableRevisionAction(project.id, id, { requestId: randomUUID(), expectedRevision: reviewed.data.deliverable.revision });
    if (!started.ok) throw new Error(started.error);
    const edited = await updateDeliverableDraftAction(project.id, id, { title: "第二版", type: "report", url: "https://example.com/v2", expectedRevision: started.data.revision });
    if (!edited.ok) throw new Error(edited.error);
    const second = await submitDeliverableAction(project.id, id, { requestId: randomUUID(), expectedRevision: edited.data.revision });
    if (!second.ok) throw new Error(second.error);
    mocks.auth.mockResolvedValue({ user: { id: teacher.id } });
    expect(await reviewDeliverableAction(project.id, id, { requestId: randomUUID(), versionId: second.data.versionId, decision: "approved" })).toMatchObject({ ok: true, data: { deliverable: { status: "approved" } } });
    mocks.auth.mockResolvedValue({ user: { id: outsider.id } });
    expect(await listProjectFeedbackAction(project.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await listTaskFeedbackAction(project.id, task.data.taskId)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("uses the session identity, returns usable errors, and completes draft/edit/submit/detail", async () => {
    const [admin, student, outsider] = await db.insert(users).values(["admin", "student", "outsider"].map((name) => ({ name, email: `${name}@actions.test`, passwordHash: "fixture" }))).returning();
    const team = await createTeam(admin.id, "接口测试");
    await joinTeam(student.id, team.inviteCode);
    const project = await createProject(admin.id, team.id, { name: "接口项目" });
    mocks.auth.mockResolvedValue({ user: { id: student.id } });
    const invalid = await createDeliverableDraftAction(project.id, { title: "报告", type: "report", requestId: randomUUID(), authorId: admin.id } as Parameters<typeof createDeliverableDraftAction>[1]);
    expect(invalid).toMatchObject({ ok: false, code: "VALIDATION" });
    const created = await createDeliverableDraftAction(project.id, { title: "报告", type: "report", requestId: randomUUID() });
    if (!created.ok) throw new Error(created.error);
    expect(created.data.authorId).toBe(student.id);
    const d = created.data;
    const updated = await updateDeliverableDraftAction(project.id, d.id, { title: d.title, type: d.type, url: "https://example.com/report", expectedRevision: d.revision });
    if (!updated.ok) throw new Error(updated.error);
    expect(await submitDeliverableAction(project.id, d.id, { requestId: randomUUID(), expectedRevision: 1 })).toMatchObject({ ok: false, code: "CONFLICT" });
    const submitted = await submitDeliverableAction(project.id, d.id, { requestId: randomUUID(), expectedRevision: updated.data.revision });
    expect(submitted).toMatchObject({ ok: true, data: { deliverable: { status: "submitted" } } });
    expect(await getDeliverableAction(project.id, d.id)).toMatchObject({ ok: true, data: { versions: [{ versionNumber: 1 }] } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${project.id}/deliverables`);
    mocks.auth.mockResolvedValue({ user: { id: outsider.id } });
    expect(await getDeliverableAction(project.id, d.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await listDeliverablesAction(project.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
