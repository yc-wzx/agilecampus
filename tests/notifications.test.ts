import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { notifications, projectActivities, tasks, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, deleteTask, updateTask } from "@/lib/task";
import { createTaskV1 } from "@/lib/task-contract";
import { getUnreadNotificationCount, listMyNotifications, markAllNotificationsRead, markNotificationRead, recordNotificationIntent } from "@/lib/notification";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import type { RecordNotificationIntentInput } from "@/contracts/p0-p2";
import { resetDb } from "./helpers";

async function scene() {
  const [owner, member, teacher, outsider] = await db.insert(users).values(["owner", "member", "teacher", "outsider"].map(name => ({ name, email: `${name}@f-notify.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(owner.id, "通知测试");
  for (const user of [member, teacher]) await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const project = await createProject(owner.id, team.id, { name: "通知项目" });
  return { owner, member, teacher, outsider, team, project };
}
function intent(s: Awaited<ReturnType<typeof scene>>, taskId: string, recipientIds = [s.member.id]): RecordNotificationIntentInput {
  return { eventKey: randomUUID(), projectId: s.project.id, actorId: s.owner.id, type: "task.assigned", recipientIds,
    summary: "真实指派通知", sourceRef: { sourceKind: "task", sourceId: taskId, projectId: s.project.id,
      sourceHref: `/projects/${s.project.id}?task=${taskId}`, evidenceKey: `task:${taskId}`, availability: "available" } };
}
describe("F notifications with current project permissions and real database", () => {
  beforeEach(resetDb);
  it("任务创建产生本人通知，分页与未读数遵循固定返回，操作者不收到自通知", async () => {
    const s = await scene();
    const task = await createTask(s.owner.id, s.project.id, { title: "通知任务", assigneeId: s.member.id });
    const page = await listMyNotifications(s.member.id, { limit: 1 });
    expect(page).toMatchObject({ total: 1, offset: 0, limit: 1, nextOffset: null });
    expect(page.items[0]).toMatchObject({ projectId: s.project.id, recipientId: s.member.id, type: "task.assigned", readAt: null,
      sourceRef: { sourceHref: `/projects/${s.project.id}?task=${task.id}`, availability: "available" } });
    expect(await getUnreadNotificationCount(s.member.id)).toMatchObject({ count: 1 });
    await createTask(s.owner.id, s.project.id, { title: "指派给自己", assigneeId: s.owner.id });
    expect((await listMyNotifications(s.owner.id)).total).toBe(0);
  });
  it("排除操作者与非成员；重复接收者、事件重投和并发重投不重复", async () => {
    const s = await scene(); const task = await createTask(s.owner.id, s.project.id, { title: "任务" });
    const data = intent(s, task.id, [s.member.id, s.member.id, s.owner.id, s.outsider.id]);
    const results = await Promise.all([db.transaction(tx => recordNotificationIntent(tx, data)), db.transaction(tx => recordNotificationIntent(tx, data))]);
    expect(results.map(r => r.createdCount).sort()).toEqual([0, 1]);
    expect((await listMyNotifications(s.member.id)).total).toBe(1);
    expect((await listMyNotifications(s.outsider.id)).total).toBe(0);
  });
  it("V1 请求重放保持活动和通知各一条", async () => {
    const s = await scene(); const input = { requestId: randomUUID(), title: "幂等指派", assigneeId: s.member.id };
    const first = await createTaskV1(s.owner.id, s.project.id, input);
    expect(await createTaskV1(s.owner.id, s.project.id, input)).toEqual(first);
    expect((await listMyNotifications(s.member.id)).total).toBe(1);
    expect((await db.select().from(projectActivities)).length).toBe(1);
  });
  it("A→B→A 的再次指派是新事件；同一事务连续更新仍有不同版本", async () => {
    const s = await scene(); const task = await createTask(s.owner.id, s.project.id, { title: "改派", assigneeId: s.member.id });
    await db.transaction(async tx => {
      const one = await updateTask(s.owner.id, task.id, { assigneeId: s.teacher.id }, { tx });
      const two = await updateTask(s.owner.id, task.id, { assigneeId: s.member.id }, { tx });
      expect(two.updatedAt.getTime()).toBeGreaterThan(one.updatedAt.getTime());
    });
    expect((await listMyNotifications(s.member.id)).total).toBe(2);
    expect((await listMyNotifications(s.teacher.id)).total).toBe(1);
  });
  it("单条已读只改本人，重复点击返回同一 readAt", async () => {
    const s = await scene(); await createTask(s.owner.id, s.project.id, { title: "任务", assigneeId: s.member.id });
    const item = (await listMyNotifications(s.member.id)).items[0];
    await expect(markNotificationRead(s.teacher.id, item.id)).rejects.toBeInstanceOf(ForbiddenError);
    const first = await markNotificationRead(s.member.id, item.id);
    expect(await markNotificationRead(s.member.id, item.id)).toEqual(first);
    expect((await getUnreadNotificationCount(s.member.id)).count).toBe(0);
    expect((await listMyNotifications(s.member.id, { unreadOnly: true })).total).toBe(0);
  });
  it("全部已读保留界线后一微秒的新消息；重放返回原计数，换内容冲突", async () => {
    const s = await scene(); const task = await createTask(s.owner.id, s.project.id, { title: "任务", assigneeId: s.member.id });
    const { asOf } = await getUnreadNotificationCount(s.member.id);
    const data = intent(s, task.id); await db.transaction(tx => recordNotificationIntent(tx, data));
    await db.update(notifications).set({ createdAt: sql`${asOf}::timestamptz + interval '1 microsecond'` }).where(eq(notifications.eventKey, data.eventKey));
    const input = { requestId: randomUUID(), beforeCreatedAt: asOf };
    const first = await markAllNotificationsRead(s.member.id, input);
    expect(first.markedCount).toBe(1);
    expect(await markAllNotificationsRead(s.member.id, input)).toEqual(first);
    expect((await getUnreadNotificationCount(s.member.id)).count).toBe(1);
    await expect(markAllNotificationsRead(s.member.id, { ...input, beforeCreatedAt: "2020-01-01T00:00:00Z" })).rejects.toBeInstanceOf(ConflictError);
  });
  it("退组后不再读旧摘要或未读数，也不能标已读", async () => {
    const s = await scene(); await createTask(s.owner.id, s.project.id, { title: "团队内部任务", assigneeId: s.member.id });
    const item = (await listMyNotifications(s.member.id)).items[0];
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, s.team.id), eq(teamMembers.userId, s.member.id)));
    expect((await listMyNotifications(s.member.id)).total).toBe(0);
    expect((await getUnreadNotificationCount(s.member.id)).count).toBe(0);
    await expect(markNotificationRead(s.member.id, item.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listMyNotifications(s.member.id, { projectId: s.project.id })).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("教师变学生后不再看到提交审核通知", async () => {
    const s = await scene(); const task = await createTask(s.owner.id, s.project.id, { title: "审核通知来源" });
    await db.transaction(tx => recordNotificationIntent(tx, { ...intent(s, task.id, [s.teacher.id, s.member.id]), type: "deliverable.submitted" }));
    expect((await listMyNotifications(s.teacher.id)).total).toBe(1);
    expect((await listMyNotifications(s.member.id)).total).toBe(0);
    await updateMemberRole(s.owner.id, s.team.id, s.teacher.id, "student");
    expect((await listMyNotifications(s.teacher.id)).total).toBe(0);
  });
  it("来源删除后显示占位，不保留可点击死链接或摘要", async () => {
    const s = await scene(); const task = await createTask(s.owner.id, s.project.id, { title: "旧标题", assigneeId: s.member.id });
    await deleteTask(s.owner.id, task.id);
    expect((await listMyNotifications(s.member.id)).items[0]).toMatchObject({ summary: "来源已删除", sourceRef: { availability: "deleted", sourceHref: null } });
  });
  it("业务回滚时任务、活动和通知都回滚", async () => {
    const s = await scene();
    await expect(db.transaction(async tx => { await createTask(s.owner.id, s.project.id, { title: "回滚", assigneeId: s.member.id }, { tx }); throw new Error("abort"); })).rejects.toThrow("abort");
    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(await db.select().from(projectActivities)).toHaveLength(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
  it("严格拒绝伪造查询身份、非法分页、未来已读界线和外部来源链接", async () => {
    const s = await scene();
    await expect(listMyNotifications(s.member.id, { limit: 101 })).rejects.toBeInstanceOf(ValidationError);
    await expect(listMyNotifications(s.member.id, { actorId: s.owner.id } as never)).rejects.toBeInstanceOf(ValidationError);
    await expect(markAllNotificationsRead(s.member.id, { requestId: randomUUID(), beforeCreatedAt: "2099-01-01T00:00:00Z" })).rejects.toBeInstanceOf(ValidationError);
    const task = await createTask(s.owner.id, s.project.id, { title: "任务" }); const data = intent(s, task.id);
    await expect(db.transaction(tx => recordNotificationIntent(tx, { ...data, sourceRef: { ...data.sourceRef, sourceHref: "https://attacker.test" } }))).rejects.toBeInstanceOf(ValidationError);
    await expect(db.transaction(tx => recordNotificationIntent(tx, { ...data, sourceRef: { ...data.sourceRef, sourceHref: `/projects/${s.project.id}forged` } }))).rejects.toBeInstanceOf(ValidationError);
  });
});
