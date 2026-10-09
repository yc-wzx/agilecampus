import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { deliverableOutbox, users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createDeliverableDraft, reviewDeliverable, startDeliverableRevision, submitDeliverable, updateDeliverableDraft } from "@/lib/deliverable";
import { dispatchDeliverableEvents } from "@/lib/deliverable-events";
import { handleDeliverableEvent } from "@/lib/deliverable-sink";
import { listProjectActivities } from "@/lib/activity";
import { listMyNotifications } from "@/lib/notifications";
import { POST as cron } from "@/app/api/cron/reminders/route";
import { resetDb } from "./helpers";

async function scene() {
  const [owner, student, teacher] = await db.insert(users).values(["owner", "student", "teacher"].map(name => ({ name, email: `${name}@ef-sink.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(owner.id, "EF整合");
  for (const member of [student, teacher]) await joinTeam(member.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  return { owner, student, teacher, project: await createProject(owner.id, team.id, { name: "版本事件" }) };
}
describe("D outbox + E activity + F notification integration", () => {
  beforeEach(async () => { vi.unstubAllEnvs(); await resetDb(); });
  it("延迟消费仍使用事件对应的正式版本标题；活动和通知重投均不重复", async () => {
    const s = await scene(); const id = randomUUID();
    const draft = await createDeliverableDraft(s.student.id, s.project.id, { requestId: id, title: "第一版标题", type: "report", url: "https://example.com/v1" });
    const first = await submitDeliverable(s.student.id, s.project.id, draft.id, { requestId: randomUUID(), expectedRevision: draft.revision });
    const reviewed = await reviewDeliverable(s.teacher.id, s.project.id, draft.id, { requestId: randomUUID(), versionId: first.versionId, decision: "approved" });
    const revised = await startDeliverableRevision(s.student.id, s.project.id, draft.id, { requestId: randomUUID(), expectedRevision: reviewed.deliverable.revision });
    const saved = await updateDeliverableDraft(s.student.id, s.project.id, draft.id, { title: "第二版标题", type: "report", url: "https://example.com/v2", expectedRevision: revised.revision });
    await submitDeliverable(s.student.id, s.project.id, draft.id, { requestId: randomUUID(), expectedRevision: saved.revision });
    expect(await dispatchDeliverableEvents(handleDeliverableEvent)).toEqual({ delivered: 3, failed: 0 });
    const submissions = (await listProjectActivities(s.owner.id, s.project.id)).items.filter(item => item.type === "deliverable.submitted");
    expect(submissions.map(item => item.summary).sort()).toEqual(["提交了成果《第一版标题》", "提交了成果《第二版标题》"].sort());
    const notices = await listMyNotifications(s.teacher.id);
    expect(notices.total).toBe(2);
    expect(notices.items.some(item => item.summary?.includes("第一版标题") && item.sourceRef.sourceHref?.includes(first.versionId))).toBe(true);
    const before = (await listMyNotifications(s.student.id)).total;
    for (const event of await db.select().from(deliverableOutbox)) await handleDeliverableEvent(event);
    expect((await listProjectActivities(s.owner.id, s.project.id)).total).toBe(3);
    expect((await listMyNotifications(s.teacher.id)).total).toBe(2);
    expect((await listMyNotifications(s.student.id)).total).toBe(before);
  });
  it("受控 cron 真正消费成果事件，保留旧响应；再次执行不重复通知", async () => {
    const s = await scene();
    const draft = await createDeliverableDraft(s.student.id, s.project.id, { requestId: randomUUID(), title: "待验收", type: "report", url: "https://example.com" });
    await submitDeliverable(s.student.id, s.project.id, draft.id, { requestId: randomUUID(), expectedRevision: draft.revision });
    vi.stubEnv("CRON_SECRET", "local-test-cron");
    const request = () => new Request("http://test/api/cron/reminders", { method: "POST", headers: { authorization: "Bearer local-test-cron" } });
    const first = await cron(request()); expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ outboxDelivered: 1, outboxFailed: 0, notified: 0, tasksScanned: 0 });
    const second = await cron(request()); expect(await second.json()).toMatchObject({ outboxDelivered: 0, outboxFailed: 0 });
    expect((await listMyNotifications(s.teacher.id)).total).toBe(1);
    expect((await listProjectActivities(s.owner.id, s.project.id)).total).toBe(1);
  });
});
