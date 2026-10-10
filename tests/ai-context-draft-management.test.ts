import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { db } from "@/db";
import { iterationDrafts, tasks, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import {
  getOrCreateScopedConversation,
  listBoundedConversationMessages,
  buildAuthorizedProjectContext,
  requireScopedConversation,
} from "@/lib/agent/context";
import { persistTurn } from "@/lib/agent/conversation";
import {
  generateIterationDraft,
  updateIterationDraft,
  cancelIterationDraft,
  previewIterationDraft,
  confirmIterationDraft,
} from "@/lib/agent/iteration-draft";
import { resetDb } from "./helpers";
async function scene() {
  const [admin, member] = await db
    .insert(users)
    .values(
      ["admin", "member"].map((name) => ({
        name,
        email: `${name}@ai-context.test`,
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "AI 团队");
  await joinTeam(member.id, team.inviteCode);
  const project = await createProject(admin.id, team.id, { name: "AI 权限" });
  const task = await createTask(admin.id, project.id, {
    title: "真实已有任务",
  });
  return { admin, member, team, project, task };
}
function model(text: string) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text }],
      warnings: [],
    }),
  });
}
describe("有界 AI 上下文和草案生成管理", () => {
  beforeEach(resetDb);
  it("项目共享会话与本人私有会话分开，跨项目和退组不能读取", async () => {
    const s = await scene(),
      shared = await getOrCreateScopedConversation(s.admin.id, s.project.id, {
        scope: "project",
      }),
      personal = await getOrCreateScopedConversation(s.admin.id, s.project.id, {
        scope: "personal",
      });
    expect(
      (
        await getOrCreateScopedConversation(s.member.id, s.project.id, {
          scope: "project",
        })
      ).id,
    ).toBe(shared.id);
    await persistTurn(personal.id, "私人正文", "私人回答", []);
    await expect(
      listBoundedConversationMessages(s.member.id, personal.id),
    ).rejects.toThrow();
    expect(
      JSON.stringify(
        await buildAuthorizedProjectContext(s.member.id, s.project.id, {
          conversationId: shared.id,
        }),
      ),
    ).not.toContain("私人正文");
    const another = await createProject(s.admin.id, s.team.id, {
      name: "其他项目",
    });
    await expect(
      requireScopedConversation(s.admin.id, another.id, shared.id),
    ).rejects.toThrow();
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.admin.id),
        ),
      );
    await expect(
      listBoundedConversationMessages(s.admin.id, personal.id),
    ).rejects.toThrow();
  });
  it("长历史按插入顺序有界返回，游标不允许跳入其他会话", async () => {
    const s = await scene(),
      conv = await getOrCreateScopedConversation(s.admin.id, s.project.id, {
        scope: "project",
      });
    for (let i = 0; i < 12; i++)
      await persistTurn(conv.id, `${i}:` + "长".repeat(5000), `${i} 回答`, []);
    const recent = await listBoundedConversationMessages(s.member.id, conv.id, {
      limit: 10,
    });
    expect(recent.hasMore).toBe(true);
    expect(recent.truncated).toBe(true);
    expect(recent.items.map((i) => i.content).join("").length).toBeLessThan(
      12001,
    );
    expect(recent.items.at(-1)!.content).toContain("11 回答");
    expect(recent.items.every((item) => item.content.length > 0)).toBe(true);
    const previous = await listBoundedConversationMessages(
      s.member.id,
      conv.id,
      { beforeMessageId: recent.nextBeforeMessageId!, limit: 10 },
    );
    expect(
      previous.items.some((p) => recent.items.some((r) => r.id === p.id)),
    ).toBe(false);
    let page = recent;
    const seen = new Set(page.items.map((item) => item.id));
    while (page.nextBeforeMessageId) {
      page = await listBoundedConversationMessages(s.member.id, conv.id, {
        beforeMessageId: page.nextBeforeMessageId,
        limit: 10,
      });
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
    }
    expect(seen.size).toBe(24);
    await expect(
      listBoundedConversationMessages(s.member.id, conv.id, {
        beforeMessageId: randomUUID(),
      }),
    ).rejects.toThrow();
  });
  it("模型只能选真实任务，重放不重复生成；编辑不改任务，确认才建 planned 轮", async () => {
    const s = await scene(),
      conv = await getOrCreateScopedConversation(s.admin.id, s.project.id, {
        scope: "personal",
      }),
      input = {
        requestId: randomUUID(),
        conversationId: conv.id,
        prompt: "规划下周迭代",
      };
    const proposal = JSON.stringify({
      name: "联调",
      goal: "可运行",
      startDate: "2026-10-12",
      endDate: "2026-10-18",
      taskIds: [s.task.id],
    });
    const draft = await generateIterationDraft(
      s.admin.id,
      s.project.id,
      input,
      { model: model(proposal) },
    );
    expect(
      (
        await generateIterationDraft(s.admin.id, s.project.id, input, {
          model: model("不应调用"),
        })
      ).id,
    ).toBe(draft.id);
    expect(
      (await db.select().from(tasks).where(eq(tasks.id, s.task.id)))[0]
        .sprintId,
    ).toBeNull();
    const changed = await updateIterationDraft(
      s.admin.id,
      s.project.id,
      draft.id,
      { requestId: randomUUID(), expectedRevision: 1, name: "修改后的联调" },
    );
    expect(changed.revision).toBe(2);
    await expect(
      updateIterationDraft(s.member.id, s.project.id, draft.id, {
        requestId: randomUUID(),
        expectedRevision: 2,
        name: "窃取",
      }),
    ).rejects.toThrow();
    const preview = await previewIterationDraft(
      s.admin.id,
      s.project.id,
      draft.id,
    );
    expect(preview.validation.valid).toBe(true);
    const confirmed = await confirmIterationDraft(
      s.admin.id,
      s.project.id,
      draft.id,
      {
        requestId: randomUUID(),
        expectedDraftRevision: 2,
        expectedTaskVersions: preview.currentTaskVersions,
      },
    );
    expect(confirmed.iteration.status).toBe("planned");
    expect(
      (await db.select().from(tasks).where(eq(tasks.id, s.task.id)))[0]
        .sprintId,
    ).toBe(confirmed.iteration.id);
  });
  it("未知任务 ID 和错误日期不存草案；取消和过期不会修改任务", async () => {
    const s = await scene(),
      conv = await getOrCreateScopedConversation(s.admin.id, s.project.id, {
        scope: "project",
      });
    await expect(
      generateIterationDraft(
        s.admin.id,
        s.project.id,
        { requestId: randomUUID(), conversationId: conv.id, prompt: "规划" },
        {
          model: model(
            JSON.stringify({
              name: "伪造",
              goal: null,
              startDate: "2026-10-12",
              endDate: "2026-10-18",
              taskIds: [randomUUID()],
            }),
          ),
        },
      ),
    ).rejects.toThrow();
    expect(await db.select().from(iterationDrafts)).toHaveLength(0);
    const draft = await generateIterationDraft(
      s.admin.id,
      s.project.id,
      { requestId: randomUUID(), conversationId: conv.id, prompt: "规划" },
      {
        model: model(
          JSON.stringify({
            name: "取消",
            goal: null,
            startDate: "2026-10-12",
            endDate: "2026-10-18",
            taskIds: [s.task.id],
          }),
        ),
      },
    );
    await cancelIterationDraft(s.admin.id, s.project.id, draft.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
    });
    expect(
      (await db.select().from(tasks).where(eq(tasks.id, s.task.id)))[0]
        .sprintId,
    ).toBeNull();
    expect(
      (await previewIterationDraft(s.admin.id, s.project.id, draft.id))
        .validation.valid,
    ).toBe(false);
  });
});
