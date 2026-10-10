import { and, eq, sql } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  externalNotificationDeliveries as deliveries,
  tasks,
  teamMembers,
  users,
} from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { scanAndRecordDueReminders } from "@/lib/notification-reminders";
import {
  dispatchExternalNotifications,
  getMyNotificationChannels,
} from "@/lib/notification";
import { NotificationDeliveryError } from "@/lib/notification-delivery-error";
import { notifyTaskAssigned, scanAndNotifyDue } from "@/lib/notify";
import { resetDb } from "./helpers";
const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feishu", () => ({ sendCardMessage: send }));
async function scene() {
  const [owner, member] = await db
    .insert(users)
    .values(
      ["owner", "member"].map((name) => ({
        name,
        email: `${name}@notify.test`,
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(owner.id, "通知");
  await joinTeam(member.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "通知测试" });
  return { owner, member, team, project };
}
const now = new Date("2026-10-09T10:00:00+08:00");
describe("持久化通知与兼容适配器", () => {
  beforeEach(async () => {
    await resetDb();
    send.mockReset().mockResolvedValue(undefined);
    vi.stubEnv("FEISHU_APP_ID", "");
    vi.stubEnv("FEISHU_APP_SECRET", "");
  });
  afterEach(() => vi.unstubAllEnvs());
  function configure() {
    vi.stubEnv("FEISHU_APP_ID", "fixture");
    vi.stubEnv("FEISHU_APP_SECRET", "fixture");
  }
  it("配置缺失不发送也不丢意图；绑定并配置后重放只发一次", async () => {
    const s = await scene(),
      task = await createTask(s.owner.id, s.project.id, {
        title: "被指派",
        assigneeId: s.member.id,
      });
    await notifyTaskAssigned(task);
    expect(send).not.toHaveBeenCalled();
    expect((await getMyNotificationChannels(s.member.id)).externalStatus).toBe(
      "unbound",
    );
    await db
      .update(users)
      .set({ feishuOpenId: "ou_member" })
      .where(eq(users.id, s.member.id));
    expect((await getMyNotificationChannels(s.member.id)).externalStatus).toBe(
      "unconfigured",
    );
    configure();
    await notifyTaskAssigned(task);
    await notifyTaskAssigned(task);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.select().from(deliveries))[0].status).toBe("sent");
  });
  it("自指派、无负责人不发消息；其他成员完成才通知创建者", async () => {
    const s = await scene();
    configure();
    await db
      .update(users)
      .set({ feishuOpenId: "ou_owner" })
      .where(eq(users.id, s.owner.id));
    const self = await createTask(s.owner.id, s.project.id, {
      title: "自己的任务",
      assigneeId: s.owner.id,
    });
    await notifyTaskAssigned(self);
    expect(send).not.toHaveBeenCalled();
    await updateTask(s.member.id, self.id, { status: "done" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toBe("ou_owner");
  });
  it("到期按北京时间，未绑定也有站内通知，同一天不重复，改日期后重新提醒", async () => {
    const s = await scene();
    const task = await createTask(s.owner.id, s.project.id, {
      title: "逾期",
      assigneeId: s.owner.id,
      dueDate: "2026-10-08",
    });
    const later = await createTask(s.owner.id, s.project.id, {
      title: "远期",
      assigneeId: s.owner.id,
      dueDate: "2026-10-11",
    });
    const first = await scanAndRecordDueReminders(now);
    expect(first.created).toBe(1);
    expect((await scanAndRecordDueReminders(now)).created).toBe(0);
    await db
      .update(tasks)
      .set({ dueDate: "2026-10-09" })
      .where(eq(tasks.id, task.id));
    expect((await scanAndRecordDueReminders(now)).created).toBe(1);
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, task.id));
    expect((await scanAndRecordDueReminders(now)).scanned).toBe(0);
    expect(later.id).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
  });
  it("明确拒绝会退避重试，网络未知不自动重发；并发 worker 不重复发送", async () => {
    const s = await scene();
    await createTask(s.owner.id, s.project.id, {
      title: "重试",
      assigneeId: s.member.id,
    });
    await db
      .update(users)
      .set({ feishuOpenId: "ou_member" })
      .where(eq(users.id, s.member.id));
    configure();
    send.mockRejectedValueOnce(
      new NotificationDeliveryError("rejected", "PROVIDER_429"),
    );
    expect((await dispatchExternalNotifications()).failed).toBe(1);
    expect((await dispatchExternalNotifications()).sent).toBe(0);
    await db.update(deliveries).set({ nextAttemptAt: new Date(0) });
    await Promise.all([
      dispatchExternalNotifications(),
      dispatchExternalNotifications(),
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect((await db.select().from(deliveries))[0].status).toBe("sent");
    await createTask(s.owner.id, s.project.id, {
      title: "不确定",
      assigneeId: s.member.id,
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    await db.update(deliveries).set({
      status: "pending",
      deliveredAt: null,
      nextAttemptAt: new Date(0),
    });
    send.mockRejectedValue(
      new NotificationDeliveryError("uncertain", "NETWORK_RESULT_UNKNOWN"),
    );
    await dispatchExternalNotifications();
    const calls = send.mock.calls.length;
    await dispatchExternalNotifications();
    expect(send.mock.calls.length).toBe(calls);
    expect((await getMyNotificationChannels(s.member.id)).externalStatus).toBe(
      "failed",
    );
  });
  it("退组后待发通知跳过；兼容扫描函数不绕过权限与配置", async () => {
    const s = await scene();
    await createTask(s.owner.id, s.project.id, {
      title: "离组",
      assigneeId: s.member.id,
    });
    await db
      .update(users)
      .set({ feishuOpenId: "ou_member" })
      .where(eq(users.id, s.member.id));
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.member.id),
        ),
      );
    configure();
    expect((await dispatchExternalNotifications()).skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect((await db.select().from(deliveries))[0].status).toBe("skipped");
    expect((await scanAndNotifyDue()).notified).toBe(0);
    expect(
      await db.execute(sql`select count(*) from notifications`),
    ).toBeTruthy();
  });
});
