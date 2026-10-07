import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { iterationDrafts } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createSubtask, createTask, deleteTask, getTaskDetail, updateTask } from "@/lib/task";
import {
  assignTasks,
  createIteration,
  getIterationDetail,
  startIteration,
} from "@/lib/iteration";
import { getTaskPanelData, setTaskBlocked } from "@/lib/task-contract";
import {
  confirmIterationDraft,
  previewIterationDraft,
  suggestIterationCandidates,
} from "@/lib/agent/iteration-draft";
import { resetDb } from "./helpers";

// 草案的**生成与存储归 E**（E-AI05/06）。这一组测试只测 C 的那一半：
// 预览校验（C-AI01）与事务确认（C-AI02）。所以草案行直接在测试里插，
// 不假装 C 会生成它。

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

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
  return { owner, team, student, teacher, outsider, project };
}

const rid = () => randomUUID();

/** 插一条待确认草案，候选任务按传入顺序记录当时版本。 */
async function insertDraft(
  createdById: string,
  projectId: string,
  taskIds: string[],
  overrides: Partial<{ status: string; expiresAt: Date; name: string; revision: number }> = {},
) {
  const candidates = [];
  for (const id of taskIds) {
    const task = await getTaskDetail(createdById, id);
    candidates.push({
      taskId: id,
      expectedUpdatedAt: task.updatedAt.toISOString(),
      reason: "测试候选",
    });
  }
  const [row] = await db
    .insert(iterationDrafts)
    .values({
      projectId,
      createdById,
      status: overrides.status ?? "pending",
      revision: overrides.revision ?? 1,
      name: overrides.name ?? "AI 建议的第一轮",
      goal: "把最急的几件事先做完",
      startDate: "2026-10-15",
      endDate: "2026-10-28",
      candidateTasks: candidates,
      expiresAt: overrides.expiresAt ?? new Date(Date.now() + 24 * 3600 * 1000),
    })
    .returning();
  return row;
}

/** 确认输入要带「此刻的真实版本」，所以从预览取，不手写。 */
async function confirmInput(actorId: string, projectId: string, draftId: string) {
  const preview = await previewIterationDraft(actorId, projectId, draftId);
  return {
    input: {
      requestId: rid(),
      expectedDraftRevision: preview.draft.revision,
      expectedTaskVersions: preview.currentTaskVersions,
    },
    preview,
  };
}

describe("previewIterationDraft", () => {
  beforeEach(resetDb);

  it("候选任务都还能入轮时 valid 为 true，并给出此刻的真实版本", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const draft = await insertDraft(student.id, project.id, [a.id, b.id]);

    const preview = await previewIterationDraft(student.id, project.id, draft.id);

    expect(preview.draft.id).toBe(draft.id);
    expect(preview.draft.status).toBe("pending");
    expect(preview.draft.candidateTasks).toHaveLength(2);
    expect(preview.validation).toEqual({ valid: true, conflicts: [] });
    expect(preview.currentTaskVersions.map((v) => v.taskId).sort()).toEqual([a.id, b.id].sort());
  });

  it("已完成的任务逐条说明为什么不能入轮", async () => {
    const { student, project } = await scene();
    const done = await createTask(student.id, project.id, { title: "做完了" });
    await updateTask(student.id, done.id, { status: "done" });
    const fresh = await createTask(student.id, project.id, { title: "还没做" });
    const draft = await insertDraft(student.id, project.id, [done.id, fresh.id]);

    const preview = await previewIterationDraft(student.id, project.id, draft.id);
    expect(preview.validation.valid).toBe(false);
    expect(preview.validation.conflicts).toEqual([
      { taskId: done.id, reason: "任务已完成，不必再排进新一轮" },
    ]);
  });

  it("已被别的迭代占用的任务算冲突", async () => {
    const { student, project } = await scene();
    const taken = await createTask(student.id, project.id, { title: "乙" });
    const draft = await insertDraft(student.id, project.id, [taken.id]);
    // 生成草案之后任务被别人排进了某轮迭代
    const iteration = await createIteration(student.id, project.id, {
      requestId: rid(),
      name: "第一轮",
      startDate: "2026-10-01",
      endDate: "2026-10-14",
    });
    const started = await startIteration(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: iteration.revision,
    });
    const fresh = await getTaskDetail(student.id, taken.id);
    await assignTasks(student.id, project.id, iteration.id, {
      requestId: rid(),
      expectedRevision: started.revision,
      tasks: [{ taskId: taken.id, expectedUpdatedAt: fresh.updatedAt.toISOString() }],
    });

    const preview = await previewIterationDraft(student.id, project.id, draft.id);
    expect(preview.validation.valid).toBe(false);
    expect(preview.validation.conflicts[0].reason).toBe("任务已被排入其他迭代");
  });

  it("被删掉的任务算冲突，且不进版本基线", async () => {
    const { student, project } = await scene();
    const gone = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [gone.id]);
    await deleteTask(student.id, gone.id);

    const preview = await previewIterationDraft(student.id, project.id, draft.id);
    expect(preview.validation.conflicts).toEqual([
      { taskId: gone.id, reason: "任务不存在或已被删除" },
    ]);
    expect(preview.currentTaskVersions).toEqual([]);
  });

  it("子任务不能单独入轮", async () => {
    const { student, project } = await scene();
    const parent = await createTask(student.id, project.id, { title: "父任务" });
    const child = await createSubtask(student.id, parent.id, { title: "子任务" });
    const draft = await insertDraft(student.id, project.id, [child.id]);

    const preview = await previewIterationDraft(student.id, project.id, draft.id);
    expect(preview.validation.conflicts).toEqual([
      { taskId: child.id, reason: "子任务跟随父任务入轮，不能单独选择" },
    ]);
  });

  it("过了 24 小时的草案落成 expired，且不再 valid", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id], {
      expiresAt: new Date(Date.now() - 1000),
    });

    const preview = await previewIterationDraft(student.id, project.id, draft.id);
    expect(preview.draft.status).toBe("expired");
    expect(preview.validation.valid).toBe(false);

    // 落回列里了：别人再读也是 expired
    const [stored] = await db
      .select({ status: iterationDrafts.status })
      .from(iterationDrafts)
      .where(eq(iterationDrafts.id, draft.id));
    expect(stored.status).toBe("expired");
  });

  it("已取消的草案不 valid", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id], { status: "cancelled" });
    const preview = await previewIterationDraft(student.id, project.id, draft.id);
    expect(preview.draft.status).toBe("cancelled");
    expect(preview.validation.valid).toBe(false);
  });

  it("名称空白这类草案级问题也算 invalid（conflicts 为空）", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id], { name: "   " });
    const preview = await previewIterationDraft(student.id, project.id, draft.id);
    expect(preview.validation).toEqual({ valid: false, conflicts: [] });
  });

  it("别的项目的人读不到这条草案", async () => {
    const { student, project, outsider } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id]);
    await expect(previewIterationDraft(outsider.id, project.id, draft.id)).rejects.toThrow();
  });
});

describe("confirmIterationDraft", () => {
  beforeEach(resetDb);

  it("建出一轮 planned 迭代并归入任务，不自动开始", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const draft = await insertDraft(student.id, project.id, [a.id, b.id]);
    const { input } = await confirmInput(student.id, project.id, draft.id);

    const result = await confirmIterationDraft(student.id, project.id, draft.id, input);

    expect(result.replayed).toBe(false);
    expect(result.iteration.status).toBe("planned");
    expect(result.iteration.name).toBe("AI 建议的第一轮");
    expect(result.taskIds.sort()).toEqual([a.id, b.id].sort());

    const detail = await getIterationDetail(student.id, project.id, result.iteration.id);
    expect(detail.tasks.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(detail.history.map((h) => h.type)).toEqual(["created", "tasks_assigned"]);
  });

  it("同一条草案重放返回原迭代，不再建第二轮", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id]);
    const { input } = await confirmInput(student.id, project.id, draft.id);

    const first = await confirmIterationDraft(student.id, project.id, draft.id, input);
    const replay = await confirmIterationDraft(student.id, project.id, draft.id, {
      ...input,
      requestId: rid(),
    });

    expect(replay.replayed).toBe(true);
    expect(replay.iteration.id).toBe(first.iteration.id);
    expect(replay.taskIds).toEqual(first.taskIds);
  });

  it("确认之后草案状态与版本都推进，revision 不再对得上", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id]);
    const { input } = await confirmInput(student.id, project.id, draft.id);
    await confirmIterationDraft(student.id, project.id, draft.id, input);

    const [stored] = await db.select().from(iterationDrafts).where(eq(iterationDrafts.id, draft.id));
    expect(stored.status).toBe("confirmed");
    expect(stored.revision).toBe(2);
    expect(stored.confirmedIterationId).not.toBeNull();
  });

  it("预览之后有任务被改动 → 整体拒绝，一个任务都不入轮", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const draft = await insertDraft(student.id, project.id, [a.id, b.id]);
    const { input } = await confirmInput(student.id, project.id, draft.id);

    await updateTask(student.id, b.id, { title: "乙改名了" });

    await expect(confirmIterationDraft(student.id, project.id, draft.id, input)).rejects.toThrow(
      "请重新预览",
    );
    expect((await getTaskDetail(student.id, a.id)).sprintId).toBeNull();
  });

  it("版本基线漏了任务、或混进了多余的任务，都拒绝", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const draft = await insertDraft(student.id, project.id, [a.id, b.id]);
    const { input } = await confirmInput(student.id, project.id, draft.id);

    await expect(
      confirmIterationDraft(student.id, project.id, draft.id, {
        ...input,
        expectedTaskVersions: input.expectedTaskVersions.slice(0, 1),
      }),
    ).rejects.toThrow("请重新预览");

    await expect(
      confirmIterationDraft(student.id, project.id, draft.id, {
        ...input,
        expectedTaskVersions: [
          ...input.expectedTaskVersions,
          { taskId: randomUUID(), updatedAt: new Date().toISOString() },
        ],
      }),
    ).rejects.toThrow("请重新预览");
  });

  it("陈旧 expectedDraftRevision 拒绝", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id]);
    const { input } = await confirmInput(student.id, project.id, draft.id);

    await expect(
      confirmIterationDraft(student.id, project.id, draft.id, {
        ...input,
        expectedDraftRevision: input.expectedDraftRevision + 3,
      }),
    ).rejects.toThrow("草案已被修改");
  });

  it("已取消的草案不能确认", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id], { status: "cancelled" });
    const { input } = await confirmInput(student.id, project.id, draft.id);
    await expect(confirmIterationDraft(student.id, project.id, draft.id, input)).rejects.toThrow(
      "草案已取消",
    );
  });

  it("过期草案不能确认", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id], {
      expiresAt: new Date(Date.now() - 1000),
    });
    const { input } = await confirmInput(student.id, project.id, draft.id);
    await expect(confirmIterationDraft(student.id, project.id, draft.id, input)).rejects.toThrow(
      "草案已过期",
    );
  });

  it("只有创建者能确认，同项目的别人（含 admin）也不行", async () => {
    const { owner, student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const draft = await insertDraft(student.id, project.id, [a.id]);
    const { input } = await confirmInput(owner.id, project.id, draft.id);

    await expect(confirmIterationDraft(owner.id, project.id, draft.id, input)).rejects.toThrow(
      "只有草案创建者可以确认",
    );
  });

  it("创建者本人是 teacher 时也确认不了（草案写得出来，业务写不进去）", async () => {
    const { teacher, project } = await scene();
    const draft = await insertDraft(teacher.id, project.id, []);

    await expect(
      confirmIterationDraft(teacher.id, project.id, draft.id, {
        requestId: rid(),
        expectedDraftRevision: draft.revision,
        expectedTaskVersions: [],
      }),
    ).rejects.toThrow("没有权限");
  });

  it("确认要带上草案里的任务——version 基线与候选不一致时拒绝", async () => {
    const { student, project } = await scene();
    const a = await createTask(student.id, project.id, { title: "甲" });
    const b = await createTask(student.id, project.id, { title: "乙" });
    const draft = await insertDraft(student.id, project.id, [a.id]);
    const fresh = await getTaskDetail(student.id, b.id);

    await expect(
      confirmIterationDraft(student.id, project.id, draft.id, {
        requestId: rid(),
        expectedDraftRevision: draft.revision,
        expectedTaskVersions: [{ taskId: b.id, updatedAt: fresh.updatedAt.toISOString() }],
      }),
    ).rejects.toThrow("请重新预览");
  });
});

describe("suggestIterationCandidates（供 E-AI05 使用）", () => {
  beforeEach(resetDb);

  it("紧急、已指派、已在推进的排在前面，每条都带得出理由", async () => {
    const { student, project } = await scene();
    await createTask(student.id, project.id, { title: "低优先级" });
    const urgent = await createTask(student.id, project.id, {
      title: "紧急的",
      priority: "high",
      dueDate: "2020-01-01",
      assigneeId: student.id,
    });

    const picks = await suggestIterationCandidates(student.id, project.id);
    expect(picks[0].taskId).toBe(urgent.id);
    expect(picks[0].reason).toContain("优先级高");
    expect(picks[0].reason).toContain("已逾期");
    expect(picks[0].expectedUpdatedAt).toBeTruthy();
  });

  it("阻塞中的任务不进建议（排进去也是白排）", async () => {
    const { student, project } = await scene();
    const stuck = await createTask(student.id, project.id, { title: "被卡的" });
    const panel = await getTaskPanelData(student.id, project.id, stuck.id);
    await setTaskBlocked(student.id, project.id, stuck.id, {
      requestId: rid(),
      expectedUpdatedAt: panel.task.updatedAt,
      isBlocked: true,
      blockedReason: "等接口",
    });

    const picks = await suggestIterationCandidates(student.id, project.id);
    expect(picks.map((p) => p.taskId)).not.toContain(stuck.id);
  });

  it("size 限制建议条数", async () => {
    const { student, project } = await scene();
    for (const title of ["甲", "乙", "丙"]) {
      await createTask(student.id, project.id, { title });
    }
    const picks = await suggestIterationCandidates(student.id, project.id, { size: 2 });
    expect(picks).toHaveLength(2);
  });
});
