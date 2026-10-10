import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { resetDb } from "./helpers";
const mock = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
import {
  createProjectReferenceAction,
  updateProjectReferenceAction,
  deleteProjectReferenceAction,
  setProjectLeaderAction,
} from "@/app/(app)/projects/[projectId]/extras/actions";
async function scene() {
  const [admin, student, outsider] = await db
    .insert(users)
    .values(
      ["admin", "student", "outsider"].map((name) => ({
        name,
        email: name + "@p3-actions.test",
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "P3接口");
  await joinTeam(student.id, team.inviteCode);
  const project = await createProject(admin.id, team.id, { name: "统一接口" });
  return { admin, student, outsider, project };
}
beforeEach(async () => {
  mock.auth.mockReset();
  await resetDb();
});
describe("P3 Actions share the P0-P2 Result contract", () => {
  it("returns UNAUTHENTICATED before all writes", async () => {
    mock.auth.mockResolvedValue(null);
    const project = randomUUID(),
      id = randomUUID();
    expect(
      await createProjectReferenceAction(project, {
        requestId: randomUUID(),
        title: "文档",
        type: "document",
        url: "https://example.com",
      }),
    ).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(
      await updateProjectReferenceAction(project, id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        title: "文档",
        type: "document",
        url: "https://example.com",
      }),
    ).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(
      await deleteProjectReferenceAction(project, id, {
        requestId: randomUUID(),
        expectedRevision: 1,
      }),
    ).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(
      await setProjectLeaderAction(project, {
        requestId: randomUUID(),
        expectedRevision: 0,
        leaderId: null,
      }),
    ).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
  it("uses the session actor, validates requests, and completes create/edit/delete with deduplication", async () => {
    const s = await scene();
    mock.auth.mockResolvedValue({ user: { id: s.student.id } });
    const input = {
      requestId: randomUUID(),
      title: "资料",
      type: "document" as const,
      url: "https://docs.qq.com/example",
    };
    expect(
      await createProjectReferenceAction(s.project.id, {
        ...input,
        actorId: s.admin.id,
      } as typeof input),
    ).toMatchObject({ ok: false, code: "VALIDATION" });
    const created = await createProjectReferenceAction(s.project.id, input);
    if (!created.ok) throw Error(created.error);
    expect(created.data.createdById).toBe(s.student.id);
    const edit = {
      ...input,
      title: "新资料",
      requestId: randomUUID(),
      expectedRevision: 1,
    };
    expect(
      await updateProjectReferenceAction(s.project.id, created.data.id, edit),
    ).toMatchObject({ ok: true, data: { revision: 2 } });
    expect(
      await updateProjectReferenceAction(s.project.id, created.data.id, {
        ...edit,
        requestId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "CONFLICT" });
    const deletion = { requestId: randomUUID(), expectedRevision: 2 };
    expect(
      await deleteProjectReferenceAction(
        s.project.id,
        created.data.id,
        deletion,
      ),
    ).toMatchObject({ ok: true, data: { deleted: true } });
    expect(
      await deleteProjectReferenceAction(
        s.project.id,
        created.data.id,
        deletion,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await createProjectReferenceAction(s.project.id, input),
    ).toMatchObject({ ok: false, code: "CONFLICT" });
  });
  it("denies another team and prevents leaders from gaining administrator rights", async () => {
    const s = await scene();
    mock.auth.mockResolvedValue({ user: { id: s.admin.id } });
    expect(
      await setProjectLeaderAction(s.project.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        leaderId: s.student.id,
      }),
    ).toMatchObject({ ok: true });
    mock.auth.mockResolvedValue({ user: { id: s.student.id } });
    expect(
      await setProjectLeaderAction(s.project.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        leaderId: s.admin.id,
      }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    mock.auth.mockResolvedValue({ user: { id: s.outsider.id } });
    expect(
      await createProjectReferenceAction(s.project.id, {
        requestId: randomUUID(),
        title: "越权",
        type: "document",
        url: "https://example.com",
      }),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
