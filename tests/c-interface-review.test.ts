import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { ERROR_CODES } from "@/contracts/p0-p2";
import { NotFoundError } from "@/lib/errors";
import { runAction } from "@/lib/action-result";
import { hashRequest } from "@/lib/write-request";
import { createTaskV1Action, updateTaskV1Action } from "@/app/(app)/projects/[projectId]/tasks/actions";
import { createIterationAction } from "@/app/(app)/projects/[projectId]/iterations/actions";
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "actor" } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
describe("冻结接口检查", () => {
  it("只保留统一五种错误码", () => expect(ERROR_CODES).toEqual(["UNAUTHENTICATED", "FORBIDDEN", "VALIDATION", "CONFLICT", "INTERNAL"]));
  it("不存在与无权访问统一返回 FORBIDDEN", async () => expect(await runAction(async () => { throw new NotFoundError("不可访问"); })).toEqual({ ok: false, code: "FORBIDDEN", error: "不可访问" }));
  it("创建拒绝多余字段，不静默吞掉伪造身份", async () => {
    const input = { requestId: randomUUID(), title: "任务", actorId: randomUUID() };
    expect(await createTaskV1Action(randomUUID(), input)).toMatchObject({ ok: false, code: "VALIDATION" });
  });
  it("嵌套 patch 拒绝更改所属项目", async () => {
    const input = { requestId: randomUUID(), expectedUpdatedAt: new Date().toISOString(), patch: { title: "任务", projectId: randomUUID() } };
    expect(await updateTaskV1Action(randomUUID(), randomUUID(), input)).toMatchObject({ ok: false, code: "VALIDATION" });
  });
  it("创建迭代拒绝强制 active 状态", async () => {
    const input = { requestId: randomUUID(), name: "第一轮", startDate: "2026-10-01", endDate: "2026-10-15", status: "active" };
    expect(await createIterationAction(randomUUID(), input)).toMatchObject({ ok: false, code: "VALIDATION" });
  });
  it("同内容对象的键顺序不影响请求哈希", () => expect(hashRequest({ b: 2, a: { y: 3, x: 4 } })).toBe(hashRequest({ a: { x: 4, y: 3 }, b: 2 })));
});
