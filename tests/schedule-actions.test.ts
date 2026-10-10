import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth }));
import { db } from "@/db";
import { users, personalScheduleEvents } from "@/db/schema";
import { resetDb } from "./helpers";
import {
  previewScheduleAction,
  importScheduleAction,
  addManualScheduleAction,
  saveSchedulePreferencesAction,
  changeScheduleEventAction,
  generatePersonalPlanAction,
  changePersonalPlanAction,
  addEmergencyScheduleAction,
  saveScheduleSharingAction,
} from "@/app/(app)/schedule/actions";
import { GET } from "@/app/api/teams/[teamId]/availability/route";
import { createTeam, joinTeam } from "@/lib/team";
beforeEach(async () => {
  await resetDb();
  auth.mockReset();
});
it("所有新 Action 未登录时返回固定错误码", async () => {
  auth.mockResolvedValue(null);
  const id = randomUUID(),
    requestId = randomUUID();
  const results = await Promise.all([
    previewScheduleAction({
      format: "ics",
      content: "bad",
      startDate: "2026-10-12",
      endDate: "2026-10-20",
    }),
    importScheduleAction({ requestId, source: "csv", events: [] }),
    addManualScheduleAction({
      requestId,
      title: "课程",
      start: "bad",
      end: "bad",
      repeatWeeks: 1,
      intervalWeeks: 1,
    }),
    saveSchedulePreferencesAction({
      requestId,
      expectedRevision: 0,
      preferences: {},
    }),
    changeScheduleEventAction(id, { requestId, expectedRevision: 1 }),
    generatePersonalPlanAction(id, {
      requestId,
      startDate: "2026-10-12",
      days: 7,
      mode: "rules",
      goal: "",
      selections: [],
    }),
    changePersonalPlanAction(id, id, {
      requestId,
      expectedRevision: 1,
      action: "confirm",
    }),
    addEmergencyScheduleAction({ requestId, start: "bad", end: "bad" }),
    saveScheduleSharingAction({
      requestId,
      expectedRevision: 0,
      teamIds: [],
      shareWorkPlans: false,
    }),
  ]);
  expect(results.every((r) => !r.ok && r.code === "UNAUTHENTICATED")).toBe(
    true,
  );
});
it("临时事件无需原因、默认私有，重复请求只保存一次；过长和身份注入被拒绝", async () => {
  const [user] = await db
    .insert(users)
    .values({
      name: "临时用户",
      email: "emergency@action.test",
      passwordHash: "fixture",
    })
    .returning();
  auth.mockResolvedValue({ user: { id: user.id } });
  const input = {
    requestId: randomUUID(),
    start: "2026-10-12T18:00",
    end: "2026-10-12T20:00",
  };
  expect((await addEmergencyScheduleAction(input)).ok).toBe(true);
  expect((await addEmergencyScheduleAction(input)).ok).toBe(true);
  const [event] = await db.select().from(personalScheduleEvents);
  expect(event.title).toBe("临时安排");
  expect(event.shareBusy).toBe(false);
  expect(event.source).toBe("emergency");
  expect(
    (
      await addEmergencyScheduleAction({
        ...input,
        requestId: randomUUID(),
        end: "2026-10-20T20:00",
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await addEmergencyScheduleAction({
        ...input,
        requestId: randomUUID(),
        actorId: randomUUID(),
      } as typeof input)
    ).ok,
  ).toBe(false);
  expect(await db.select().from(personalScheduleEvents)).toHaveLength(1);
});
it("团队日程 API 每次鉴权，不缓存个人时间，不输出秘密字段", async () => {
  const [user, member, outsider] = await db
    .insert(users)
    .values(
      ["user", "member", "outsider"].map((name) => ({
        name,
        email: name + "@availability-api.test",
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(user.id, "API 团队");
  await joinTeam(member.id, team.inviteCode);
  const context = { params: Promise.resolve({ teamId: team.id }) },
    request = new Request(
      "http://localhost/api/teams/" + team.id + "/availability?from=2026-10-12",
    );
  auth.mockResolvedValue(null);
  expect((await GET(request, context)).status).toBe(401);
  auth.mockResolvedValue({ user: { id: user.id } });
  await addEmergencyScheduleAction({
    requestId: randomUUID(),
    title: "不能出现在网络里的秘密",
    start: "2026-10-12T18:07",
    end: "2026-10-12T19:03",
    shareBusy: true,
  });
  await saveScheduleSharingAction({
    requestId: randomUUID(),
    expectedRevision: 0,
    teamIds: [team.id],
    shareWorkPlans: false,
  });
  auth.mockResolvedValue({ user: { id: member.id } });
  const response = await GET(request, context),
    dto = await response.json();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(
    dto.members.find((m: { id: string }) => m.id === user.id).periods,
  ).toEqual([
    { startAt: "2026-10-12T10:00:00.000Z", endAt: "2026-10-12T11:30:00.000Z" },
  ]);
  expect(JSON.stringify(dto)).not.toContain("秘密");
  auth.mockResolvedValue({ user: { id: outsider.id } });
  expect((await GET(request, context)).status).toBe(403);
  auth.mockResolvedValue({ user: { id: member.id } });
  expect(
    (await GET(new Request(request.url + "&days=365"), context)).status,
  ).toBe(400);
});
it("客户端注入 actorId 不改变身份且返回 VALIDATION", async () => {
  const [user] = await db
    .insert(users)
    .values({
      name: "本人",
      email: "own@schedule-action.test",
      passwordHash: "fixture",
    })
    .returning();
  auth.mockResolvedValue({ user: { id: user.id } });
  const input = {
    requestId: randomUUID(),
    source: "csv" as const,
    events: [
      {
        title: "课程",
        startAt: "2026-10-12T10:00:00Z",
        endAt: "2026-10-12T11:00:00Z",
      },
    ],
    actorId: randomUUID(),
  };
  const result = await importScheduleAction(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe("VALIDATION");
  expect(await db.select().from(personalScheduleEvents)).toEqual([]);
});
