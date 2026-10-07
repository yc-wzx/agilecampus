import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users, teamMembers } from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createDeliverableDraft, submitDeliverable, reviewDeliverable } from "@/lib/deliverable";
import * as reporting from "@/lib/deliverable-reporting";
import { resetDb } from "./helpers";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
import { getProjectDeliverableStatsAction, listTeacherDeliverableStatsAction, listMyRevisionRequiredDeliverablesAction, listDeliverableEvidenceAction } from "@/app/(app)/projects/[projectId]/deliverables/actions";
import { GET } from "@/app/api/projects/[projectId]/deliverable-evidence/[kind]/[recordId]/route";

async function scene() {
  const [admin, student, teacher, outsider] = await db.insert(users).values(["admin", "student", "teacher", "outsider"].map((name) => ({ name, email: `${name}@p2-http.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id, "P2接口测试");
  for (const u of [student, teacher]) await joinTeam(u.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "项目" });
  const other = await createProject(admin.id, team.id, { name: "其他项目" });
  const draft = await createDeliverableDraft(student.id, project.id, { title: "报告", type: "report", url: "https://example.com/report", requestId: randomUUID() });
  const submitted = await submitDeliverable(student.id, project.id, draft.id, { requestId: randomUUID(), expectedRevision: draft.revision });
  const reviewed = await reviewDeliverable(teacher.id, project.id, draft.id, { versionId: submitted.versionId, requestId: randomUUID(), decision: "changes_requested", comment: "补充材料" });
  return { admin, student, teacher, outsider, team, project, other, submitted, reviewed };
}
function request(projectId: string, kind: string, recordId: string) {
  return GET(new Request(`http://localhost/api/projects/${projectId}/deliverable-evidence/${kind}/${recordId}`),
    { params: Promise.resolve({ projectId, kind, recordId }) });
}

describe("D P2 Actions and evidence GET (real DB, session/cache stubbed)", () => {
  beforeEach(async () => { vi.restoreAllMocks(); vi.resetAllMocks(); await resetDb(); });

  it("rejects unauthenticated calls to all four Actions and the evidence route", async () => {
    mocks.auth.mockResolvedValue(null);
    for (const result of await Promise.all([
      getProjectDeliverableStatsAction(randomUUID()), listTeacherDeliverableStatsAction(),
      listMyRevisionRequiredDeliverablesAction(), listDeliverableEvidenceAction(randomUUID()),
    ])) expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    const response = await request(randomUUID(), "submission", randomUUID());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("uses the session identity and returns consistent counts and evidence source records", async () => {
    const s = await scene(); mocks.auth.mockResolvedValue({ user: { id: s.student.id } });
    expect(await getProjectDeliverableStatsAction(s.project.id)).toMatchObject({ ok: true, data: { total: 1, byStatus: { changes_requested: 1 } } });
    expect(await listMyRevisionRequiredDeliverablesAction()).toMatchObject({ ok: true, data: { items: [{ authorId: s.student.id, feedbackId: s.reviewed.feedback.id }] } });
    expect(await listTeacherDeliverableStatsAction()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    mocks.auth.mockResolvedValue({ user: { id: s.teacher.id } });
    expect(await listTeacherDeliverableStatsAction()).toMatchObject({ ok: true, data: { total: 2 } });
    const evidence = await listDeliverableEvidenceAction(s.project.id);
    if (!evidence.ok) throw new Error(evidence.error);
    for (const record of evidence.data.items) {
      const response = await request(s.project.id, record.kind === "submission" ? "submission" : "feedback", record.id);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ data: record });
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects malformed, cross-project, unknown and revoked-access source requests", async () => {
    const s = await scene(); mocks.auth.mockResolvedValue({ user: { id: s.student.id } });
    expect((await request(s.project.id, "draft", s.submitted.versionId)).status).toBe(400);
    expect((await request(s.project.id, "submission", "invalid-id")).status).toBe(400);
    expect((await request(s.other.id, "submission", s.submitted.versionId)).status).toBe(403);
    expect((await request(s.project.id, "submission", randomUUID())).status).toBe(403);
    expect(await listDeliverableEvidenceAction(s.project.id, { limit: 101 })).toMatchObject({ ok: false, code: "VALIDATION" });
    mocks.auth.mockResolvedValue({ user: { id: s.outsider.id } });
    expect((await request(s.project.id, "submission", s.submitted.versionId)).status).toBe(403);
    expect(await getProjectDeliverableStatsAction(s.project.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await listDeliverableEvidenceAction(s.project.id)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    await db.delete(teamMembers).where(and(eq(teamMembers.userId, s.student.id), eq(teamMembers.teamId, s.team.id)));
    mocks.auth.mockResolvedValue({ user: { id: s.student.id } });
    expect((await request(s.project.id, "feedback", s.reviewed.feedback.id)).status).toBe(403);
  });

  it("reports backend failure distinctly from zero data without exposing connection errors", async () => {
    mocks.auth.mockResolvedValue({ user: { id: randomUUID() } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(reporting, "getDeliverableEvidenceRecord").mockRejectedValueOnce(new Error("SECRET_CONNECTION_DETAIL"));
    const response = await request(randomUUID(), "submission", randomUUID());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SECRET_CONNECTION_DETAIL");
    vi.spyOn(reporting, "getProjectDeliverableStats").mockRejectedValueOnce(new Error("SECRET_CONNECTION_DETAIL"));
    expect(await getProjectDeliverableStatsAction(randomUUID())).toMatchObject({ ok: false, code: "INTERNAL" });
  });
});
