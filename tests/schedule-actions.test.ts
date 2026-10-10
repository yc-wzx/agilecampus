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
} from "@/app/(app)/schedule/actions";
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
  ]);
  expect(results.every((r) => !r.ok && r.code === "UNAUTHENTICATED")).toBe(
    true,
  );
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
