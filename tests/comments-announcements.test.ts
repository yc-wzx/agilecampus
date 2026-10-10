import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  announcements,
  projectActivities,
  taskComments,
  teamMembers,
  users,
} from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import {
  createTaskComment,
  updateTaskComment,
  deleteTaskComment,
  listTaskComments,
  getCommentPageOffset,
} from "@/lib/comments";
import {
  publishAnnouncement,
  updateAnnouncement,
  getPinnedAnnouncement,
  listProjectAnnouncements,
  republishAnnouncement,
  setAnnouncementPinned,
  withdrawAnnouncement,
} from "@/lib/announcement";
import { listMyNotifications } from "@/lib/notification";
import { ForbiddenError, ConflictError, ValidationError } from "@/lib/errors";
import { resetDb } from "./helpers";
async function scene() {
  const [admin, teacher, one, two, outsider] = await db
    .insert(users)
    .values(
      ["admin", "teacher", "one", "two", "outsider"].map((name) => ({
        name,
        email: `${name}@completion.test`,
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "补齐模块");
  for (const member of [teacher, one, two])
    await joinTeam(member.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, {
    name: "权限与提醒",
  });
  const task = await createTask(admin.id, project.id, { title: "讨论任务" });
  return { admin, teacher, one, two, outsider, project, team, task };
}
describe("评论与公告真实数据库集成", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("评论深链接定位所在页，删除后的请求重放不能取回正文", async () => {
    const s = await scene(),
      task = await createTask(s.admin.id, s.project.id, { title: "定位" }),
      input = {
        requestId: randomUUID(),
        body: "需要删除的正文",
        mentionedUserIds: [],
      };
    const comment = await createTaskComment(
      s.one.id,
      s.project.id,
      task.id,
      input,
    );
    expect(
      await getCommentPageOffset(
        s.teacher.id,
        s.project.id,
        task.id,
        comment.id,
      ),
    ).toBe(0);
    await deleteTaskComment(s.one.id, s.project.id, task.id, comment.id, {
      requestId: randomUUID(),
      expectedRevision: 1,
    });
    expect(
      await getCommentPageOffset(
        s.teacher.id,
        s.project.id,
        task.id,
        comment.id,
      ),
    ).toBeNull();
    await expect(
      createTaskComment(s.one.id, s.project.id, task.id, input),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("教师能评论，提及去重并排除自己，重试不重复，正文不进公开活动", async () => {
    const s = await scene(),
      input = {
        requestId: randomUUID(),
        body: "正文只有讨论区能显示",
        mentionedUserIds: [s.teacher.id, s.one.id, s.one.id],
      };
    const first = await createTaskComment(
      s.teacher.id,
      s.project.id,
      s.task.id,
      input,
    );
    expect(
      await createTaskComment(s.teacher.id, s.project.id, s.task.id, input),
    ).toEqual(first);
    expect(
      (await listTaskComments(s.one.id, s.project.id, s.task.id)).items[0]
        .mentionedUserIds,
    ).toEqual([s.one.id]);
    expect((await listMyNotifications(s.one.id)).total).toBe(1);
    expect((await listMyNotifications(s.teacher.id)).total).toBe(0);
    expect(
      JSON.stringify(await db.select().from(projectActivities)),
    ).not.toContain(input.body);
  });
  it("编辑只通知首次新增成员，再移除再加入不重复；其他作者不能改删", async () => {
    const s = await scene();
    const first = await createTaskComment(s.one.id, s.project.id, s.task.id, {
      requestId: randomUUID(),
      body: "原文",
      mentionedUserIds: [s.two.id],
    });
    const edited = await updateTaskComment(
      s.one.id,
      s.project.id,
      s.task.id,
      first.id,
      {
        requestId: randomUUID(),
        expectedRevision: first.revision,
        body: "改文",
        mentionedUserIds: [s.teacher.id],
      },
    );
    await updateTaskComment(s.one.id, s.project.id, s.task.id, first.id, {
      requestId: randomUUID(),
      expectedRevision: edited.revision,
      body: "再改",
      mentionedUserIds: [s.two.id, s.teacher.id],
    });
    expect((await listMyNotifications(s.two.id)).total).toBe(1);
    expect((await listMyNotifications(s.teacher.id)).total).toBe(1);
    await expect(
      deleteTaskComment(s.two.id, s.project.id, s.task.id, first.id, {
        requestId: randomUUID(),
        expectedRevision: 3,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateTaskComment(s.one.id, s.project.id, s.task.id, first.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        body: "过时",
        mentionedUserIds: [],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it("删除清除正文并让通知来源失效；非成员提及与退组写入均拒绝", async () => {
    const s = await scene();
    await expect(
      createTaskComment(s.one.id, s.project.id, s.task.id, {
        requestId: randomUUID(),
        body: "错误",
        mentionedUserIds: [s.outsider.id],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const item = await createTaskComment(s.one.id, s.project.id, s.task.id, {
      requestId: randomUUID(),
      body: "将被删除",
      mentionedUserIds: [s.two.id],
    });
    await deleteTaskComment(s.admin.id, s.project.id, s.task.id, item.id, {
      requestId: randomUUID(),
      expectedRevision: item.revision,
    });
    expect(
      (await listTaskComments(s.two.id, s.project.id, s.task.id)).total,
    ).toBe(0);
    expect((await db.select().from(taskComments))[0].body).toBe("");
    expect(
      (await listMyNotifications(s.two.id)).items[0].sourceRef.availability,
    ).toBe("deleted");
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.one.id),
        ),
      );
    await expect(
      createTaskComment(s.one.id, s.project.id, s.task.id, {
        requestId: randomUUID(),
        body: "退组后",
        mentionedUserIds: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("公告只允许教师/管理员发布，含撤下查询仅管理者可读", async () => {
    const s = await scene(),
      input = {
        requestId: randomUUID(),
        title: "答辩时间",
        body: "周五展示",
        isPinned: true,
      };
    await expect(
      publishAnnouncement(s.one.id, s.project.id, input),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const first = await publishAnnouncement(s.teacher.id, s.project.id, input);
    expect(
      await publishAnnouncement(s.teacher.id, s.project.id, input),
    ).toEqual(first);
    expect((await listMyNotifications(s.one.id)).total).toBe(1);
    await withdrawAnnouncement(s.teacher.id, s.project.id, first.id, {
      requestId: randomUUID(),
      expectedRevision: first.revision,
    });
    expect(await getPinnedAnnouncement(s.one.id, s.project.id)).toBeNull();
    expect((await listProjectAnnouncements(s.one.id, s.project.id)).total).toBe(
      0,
    );
    expect(
      (
        await listProjectAnnouncements(s.teacher.id, s.project.id, {
          includeWithdrawn: true,
        })
      ).total,
    ).toBe(1);
    await expect(
      listProjectAnnouncements(s.one.id, s.project.id, {
        includeWithdrawn: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listMyNotifications(s.one.id)).items[0]).toMatchObject({
      summary: "来源已删除",
      sourceRef: { sourceHref: null },
    });
  });
  it("并发置顶始终仅一条，编辑不重复通知；显式重发才通知", async () => {
    const s = await scene();
    const items = await Promise.all(
      ["第一条", "第二条"].map((title) =>
        publishAnnouncement(s.teacher.id, s.project.id, {
          requestId: randomUUID(),
          title,
          body: "公告正文",
          isPinned: true,
        }),
      ),
    );
    expect(
      await db
        .select()
        .from(announcements)
        .where(eq(announcements.isPinned, true)),
    ).toHaveLength(1);
    const item = (
      await listProjectAnnouncements(s.teacher.id, s.project.id)
    ).items.find((i) => i.id === items[0].id)!;
    const updated = await updateAnnouncement(
      s.teacher.id,
      s.project.id,
      item.id,
      {
        requestId: randomUUID(),
        expectedRevision: item.revision,
        title: "编辑标题",
      },
    );
    expect((await listMyNotifications(s.one.id)).total).toBe(2);
    const next = await republishAnnouncement(
      s.teacher.id,
      s.project.id,
      item.id,
      { requestId: randomUUID(), expectedRevision: updated.revision },
    );
    expect((await listMyNotifications(s.one.id)).total).toBe(3);
    await withdrawAnnouncement(s.teacher.id, s.project.id, item.id, {
      requestId: randomUUID(),
      expectedRevision: next.revision,
    });
    await expect(
      setAnnouncementPinned(s.teacher.id, s.project.id, item.id, {
        requestId: randomUUID(),
        expectedRevision: next.revision + 1,
        isPinned: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
