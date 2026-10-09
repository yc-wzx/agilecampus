import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { listMyNotifications } from "@/lib/notifications";
import { resetDb } from "./helpers";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { GET as list } from "@/app/api/notifications/route";
import { GET as count } from "@/app/api/notifications/unread-count/route";
import { POST as read } from "@/app/api/notifications/[id]/read/route";
import { POST as readAll } from "@/app/api/notifications/read-all/route";
import { markNotificationReadAction, markAllNotificationsReadAction } from "@/app/(app)/notifications/actions";

describe("F route and Action contracts", () => {
  beforeEach(async () => { vi.resetAllMocks(); await resetDb(); });
  it("每个入口拒绝未登录；未读数错误不会伪装成零", async () => {
    mocks.auth.mockResolvedValue(null);
    const id = randomUUID();
    for (const response of [await list(new Request("http://test/api/notifications")), await count(),
      await read(new Request("http://test/api/notifications/" + id + "/read", { method: "POST" }), { params: Promise.resolve({ id }) }),
      await readAll(new Request("http://test/api/notifications/read-all", { method: "POST" }))]) {
      expect(response.status).toBe(401);
      const body = await response.json(); expect(body.code).toBe("UNAUTHENTICATED"); expect(body).not.toHaveProperty("count");
    }
    expect(await markNotificationReadAction(id)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await markAllNotificationsReadAction({ requestId: id, beforeCreatedAt: new Date().toISOString() })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
  it("真实通知只读本人；严格拒绝代传身份，来源不正确不能写", async () => {
    const [owner, member] = await db.insert(users).values(["owner", "member"].map(name => ({ name, email: `${name}@f-action.test`, passwordHash: "fixture" }))).returning();
    const team = await createTeam(owner.id, "接口"); await joinTeam(member.id, team.inviteCode);
    const project = await createProject(owner.id, team.id, { name: "项目" });
    await createTask(owner.id, project.id, { title: "真实接口任务", assigneeId: member.id });
    mocks.auth.mockResolvedValue({ user: { id: member.id } });
    const response = await list(new Request("http://test/api/notifications?limit=1"));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ total: 1, limit: 1 });
    const unread = await (await count()).json(); expect(unread).toMatchObject({ count: 1 }); expect(unread.asOf).toBeTruthy();
    expect((await list(new Request("http://test/api/notifications?actorId=" + owner.id))).status).toBe(400);
    const item = (await listMyNotifications(member.id)).items[0];
    expect((await read(new Request("http://test/api/notifications/" + item.id + "/read", { method: "POST", headers: { origin: "https://other.test" } }), { params: Promise.resolve({ id: item.id }) })).status).toBe(403);
    expect(await markNotificationReadAction(item.id)).toMatchObject({ ok: true, data: { id: item.id } });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    mocks.auth.mockResolvedValue({ user: { id: owner.id } });
    expect((await read(new Request("http://test/api/notifications/" + item.id + "/read", { method: "POST" }), { params: Promise.resolve({ id: item.id }) })).status).toBe(404);
  });
  it("批量接口拒绝缺失界线、非法 JSON 及额外字段", async () => {
    const [owner] = await db.insert(users).values({ name: "owner", email: "owner@read-all.test", passwordHash: "fixture" }).returning();
    mocks.auth.mockResolvedValue({ user: { id: owner.id } });
    for (const body of ["not json", JSON.stringify({ requestId: randomUUID() }), JSON.stringify({ requestId: randomUUID(), beforeCreatedAt: new Date().toISOString(), actorId: randomUUID() })]) {
      const response = await readAll(new Request("http://test/api/notifications/read-all", { method: "POST", body }));
      expect(response.status).toBe(400); expect(await response.json()).toMatchObject({ code: "VALIDATION" });
    }
  });
});
