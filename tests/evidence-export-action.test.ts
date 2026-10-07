import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeliverableDraft,
  reviewDeliverable,
  submitDeliverable,
} from "@/lib/deliverable";
import { createProject } from "@/lib/project";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createUser } from "@/lib/user";
import { exportDeliverableEvidenceMarkdownAction } from "@/app/(app)/projects/[projectId]/evidence/export-actions";
import { resetDb } from "./helpers";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

// 一份正式提交 + 一次退回审核 = 两条证据
async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");

  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  const draft = await createDeliverableDraft(student.id, project.id, {
    title: "用户调研报告",
    type: "report",
    url: "https://example.com/research",
    description: "第一版",
    milestoneId: null,
    requestId: randomUUID(),
  });
  const submitted = await submitDeliverable(student.id, project.id, draft.id, {
    requestId: randomUUID(),
    expectedRevision: draft.revision,
  });
  await reviewDeliverable(teacher.id, project.id, draft.id, {
    requestId: randomUUID(),
    versionId: submitted.versionId,
    decision: "changes_requested",
    comment: "请补充三场访谈记录。",
  });

  return { owner, team, student, teacher, outsider, project, deliverableId: draft.id };
}

describe("exportDeliverableEvidenceMarkdownAction", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await resetDb();
  });

  it("未登录返回 UNAUTHENTICATED，不泄露任何数据", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await exportDeliverableEvidenceMarkdownAction(
      "00000000-0000-4000-8000-000000000000",
    );
    expect(result).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("拒绝额外筛选字段", async () => {
    const s = await scene();
    mocks.auth.mockResolvedValue({ user: { id: s.student.id } });
    expect(await exportDeliverableEvidenceMarkdownAction(s.project.id, { actorId: s.teacher.id } as never)).toMatchObject({ ok: false, code: "VALIDATION" });
  });

  it("非团队成员返回 FORBIDDEN", async () => {
    const s = await scene();
    mocks.auth.mockResolvedValue({ user: { id: s.outsider.id } });
    const result = await exportDeliverableEvidenceMarkdownAction(s.project.id);
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("成员导出得到真实全文：分两类、带身份与来源、声明不含草稿", async () => {
    const s = await scene();
    mocks.auth.mockResolvedValue({ user: { id: s.student.id } });

    const result = await exportDeliverableEvidenceMarkdownAction(s.project.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.total).toBe(2);
    expect(result.data.exportedCount).toBe(2);
    expect(result.data.truncated).toBe(false);
    expect(result.data.filename).toMatch(/^evidence-[0-9a-f]{8}-\d{8}T\d{4}\.md$/);

    const md = result.data.markdown;
    expect(md).toContain("# 成果过程证据清单 · 赤壁演习");
    expect(md).toContain("## 正式提交（1）");
    expect(md).toContain("## 版本审核（1）");
    expect(md).toContain("请补充三场访谈记录。");
    expect(md).toContain("决定：要求修改");
    expect(md).toContain("私有草稿");
    expect(md).toContain(`/api/projects/${s.project.id}/deliverable-evidence/`);
    expect(md).toContain("已全部导出");
  });

  it("按类别筛选只导出该类证据", async () => {
    const s = await scene();
    mocks.auth.mockResolvedValue({ user: { id: s.student.id } });

    const result = await exportDeliverableEvidenceMarkdownAction(s.project.id, {
      kind: "review",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.total).toBe(1);
    expect(result.data.markdown).toContain("## 版本审核（1）");
    expect(result.data.markdown).not.toContain("## 正式提交（");
    expect(result.data.markdown).toContain("类别：版本审核");
  });

  it("日期区间非法时返回 VALIDATION，而不是静默导出全部", async () => {
    const s = await scene();
    mocks.auth.mockResolvedValue({ user: { id: s.student.id } });

    const result = await exportDeliverableEvidenceMarkdownAction(s.project.id, {
      fromDate: "2026-10-08",
      toDate: "2026-10-07",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("VALIDATION");
  });
});
