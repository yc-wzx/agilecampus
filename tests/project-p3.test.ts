import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  projects,
  teamMembers,
  projectReferences,
  projectCreationRequests,
} from "@/db/schema";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import {
  createProject,
  createMilestone,
  listProjectMilestones,
  getProjectForUser,
  updateProject,
} from "@/lib/project";
import {
  createProjectReference,
  updateProjectReference,
  deleteProjectReference,
  listProjectReferences,
  setProjectLeader,
  getProjectLeadership,
} from "@/lib/project-extras";
import { resetDb } from "./helpers";
import { ConflictError } from "@/lib/errors";

async function scene() {
  const [admin, student, peer, teacher, outsider] = await db
    .insert(users)
    .values(
      ["admin", "student", "peer", "teacher", "outsider"].map((name) => ({
        name,
        email: name + "@p3.test",
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "P3团队");
  for (const user of [student, peer, teacher])
    await joinTeam(user.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, { name: "P3项目" });
  const other = await createProject(admin.id, team.id, { name: "另一项目" });
  const stage = await createMilestone(admin.id, project.id, {
    title: "第一阶段",
  });
  return {
    admin,
    student,
    peer,
    teacher,
    outsider,
    team,
    project,
    other,
    stage,
  };
}
const input = () => ({
  requestId: randomUUID(),
  title: "需求组会",
  type: "meeting" as const,
  url: "https://meeting.tencent.com/example",
  meetingDate: "2026-10-03",
});
beforeEach(resetDb);

describe("P3 project templates", () => {
  it("creates all four templates with only their recommended milestones", async () => {
    const s = await scene();
    for (const [templateId, count] of [
      ["blank", 0],
      ["course", 4],
      ["research", 4],
      ["competition", 4],
    ] as const) {
      const p = await createProject(s.admin.id, s.team.id, {
        name: templateId,
        templateId,
        requestId: randomUUID(),
      });
      const stages = await listProjectMilestones(s.student.id, p.id);
      expect(stages).toHaveLength(count);
      expect(stages.every((m) => m.targetDate === null)).toBe(true);
      expect(p.templateId).toBe(templateId);
    }
  });
  it("deduplicates concurrent creation including generated stages and rejects changed content", async () => {
    const s = await scene();
    const value = {
      name: "课程",
      templateId: "course" as const,
      requestId: randomUUID(),
    };
    const [first, second] = await Promise.all([
      createProject(s.admin.id, s.team.id, value),
      createProject(s.admin.id, s.team.id, value),
    ]);
    expect(first.id).toBe(second.id);
    expect(await listProjectMilestones(s.admin.id, first.id)).toHaveLength(4);
    expect(await db.select().from(projectCreationRequests)).toHaveLength(1);
    await expect(
      createProject(s.admin.id, s.team.id, { ...value, name: "换个内容" }),
    ).rejects.toThrow(ConflictError);
  });
  it("checks roles, date ordering and unknown templates before creating anything", async () => {
    const s = await scene();
    for (const user of [s.student, s.teacher, s.outsider])
      await expect(
        createProject(user.id, s.team.id, {
          name: "越权",
          templateId: "course",
        }),
      ).rejects.toThrow("没有权限");
    await expect(
      createProject(s.admin.id, s.team.id, {
        name: "日期错误",
        startDate: "2026-10-10",
        endDate: "2026-10-01",
      }),
    ).rejects.toThrow("结束日期");
    await expect(
      createProject(s.admin.id, s.team.id, {
        name: "无效模板",
        templateId: "bad" as "blank",
      }),
    ).rejects.toThrow();
    expect(await db.select().from(projects)).toHaveLength(2);
  });
});

describe("P3 project leader", () => {
  it("sets/transfers/clears one leader, records history and grants no extra rights", async () => {
    const s = await scene();
    await setProjectLeader(s.admin.id, s.project.id, {
      leaderId: s.student.id,
      expectedRevision: 0,
    });
    expect((await getProjectForUser(s.student.id, s.project.id))?.role).toBe(
      "student",
    );
    await expect(
      updateProject(s.student.id, s.project.id, {
        name: "负责人不能擅自改项目",
      }),
    ).rejects.toThrow("没有权限");
    await setProjectLeader(s.admin.id, s.project.id, {
      leaderId: s.peer.id,
      expectedRevision: 1,
    });
    await setProjectLeader(s.admin.id, s.project.id, {
      leaderId: null,
      expectedRevision: 2,
    });
    const result = await getProjectLeadership(s.teacher.id, s.project.id);
    expect(result).toMatchObject({ leaderId: null, revision: 3 });
    expect(
      result.changes.map((r) => [r.previousLeaderName, r.leaderName]),
    ).toEqual([
      ["peer", null],
      ["student", "peer"],
      [null, "student"],
    ]);
  });
  it("rejects outsiders, non-admins, foreign members and stale concurrent transfers", async () => {
    const s = await scene();
    for (const user of [s.student, s.teacher, s.outsider])
      await expect(
        setProjectLeader(user.id, s.project.id, {
          leaderId: s.student.id,
          expectedRevision: 0,
        }),
      ).rejects.toThrow("没有权限");
    await expect(
      setProjectLeader(s.admin.id, s.project.id, {
        leaderId: s.outsider.id,
        expectedRevision: 0,
      }),
    ).rejects.toThrow("当前团队");
    const outcomes = await Promise.allSettled(
      [s.student.id, s.peer.id].map((leaderId) =>
        setProjectLeader(s.admin.id, s.project.id, {
          leaderId,
          expectedRevision: 0,
        }),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await getProjectLeadership(s.admin.id, s.project.id)).changes,
    ).toHaveLength(1);
  });
  it("keeps names in history when the leader leaves; supports clearing; no-op adds no history", async () => {
    const s = await scene();
    await setProjectLeader(s.admin.id, s.project.id, {
      leaderId: s.student.id,
      expectedRevision: 0,
    });
    expect(
      await setProjectLeader(s.admin.id, s.project.id, {
        leaderId: s.student.id,
        expectedRevision: 1,
      }),
    ).toMatchObject({ changed: false });
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.student.id),
        ),
      );
    expect(await getProjectLeadership(s.admin.id, s.project.id)).toMatchObject({
      name: "student",
      active: false,
    });
    await expect(
      getProjectLeadership(s.student.id, s.project.id),
    ).rejects.toThrow("没有权限");
    await setProjectLeader(s.admin.id, s.project.id, {
      leaderId: null,
      expectedRevision: 1,
    });
    expect(
      (await getProjectLeadership(s.admin.id, s.project.id)).changes[0]
        .previousLeaderName,
    ).toBe("student");
  });
});

describe("P3 meeting and reference records", () => {
  it("persists meetings, minutes, recordings, stage and participant snapshots without exposing request keys", async () => {
    const s = await scene();
    const value = {
      ...input(),
      minutesUrl: "https://docs.qq.com/example",
      recordingUrl: "https://example.com/video",
      participantIds: [s.student.id, s.teacher.id, s.student.id],
      milestoneId: s.stage.id,
    };
    const [a, b] = await Promise.all([
      createProjectReference(s.student.id, s.project.id, value),
      createProjectReference(s.student.id, s.project.id, value),
    ]);
    expect(a.id).toBe(b.id);
    expect(a.participants).toHaveLength(2);
    expect(a.milestoneTitle).toBe("第一阶段");
    expect(a).not.toHaveProperty("requestHash");
    expect(a).not.toHaveProperty("requestId");
    await expect(
      createProjectReference(s.student.id, s.project.id, {
        ...value,
        title: "不同内容",
      }),
    ).rejects.toThrow(ConflictError);
    expect(
      (await listProjectReferences(s.teacher.id, s.project.id)).items[0],
    ).toMatchObject({ canEdit: false, minutesUrl: value.minutesUrl });
  });
  it("only allows author/admin editing and deletion; checks optimistic revisions and project IDs", async () => {
    const s = await scene();
    const r = await createProjectReference(s.student.id, s.project.id, input());
    const edited = {
      title: "修改后",
      type: "meeting" as const,
      url: r.url,
      expectedRevision: 1,
    };
    for (const user of [s.peer, s.teacher, s.outsider])
      await expect(
        updateProjectReference(user.id, s.project.id, r.id, edited),
      ).rejects.toThrow("没有权限");
    await expect(
      updateProjectReference(s.student.id, s.other.id, r.id, edited),
    ).rejects.toThrow("没有权限");
    const updated = await updateProjectReference(
      s.admin.id,
      s.project.id,
      r.id,
      edited,
    );
    expect(updated.revision).toBe(2);
    await expect(
      deleteProjectReference(s.student.id, s.project.id, r.id, 1),
    ).rejects.toThrow("已被更新");
    await expect(
      deleteProjectReference(s.peer.id, s.project.id, r.id, 2),
    ).rejects.toThrow("没有权限");
    await deleteProjectReference(s.student.id, s.project.id, r.id, 2);
    expect(
      (await listProjectReferences(s.admin.id, s.project.id)).items,
    ).toHaveLength(0);
  });
  it("rejects unsafe links, foreign participants/stages and hidden meeting fields on documents", async () => {
    const s = await scene();
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,evil",
      "https://user:pass@example.com",
      "https://exa\nmple.com",
    ]) {
      await expect(
        createProjectReference(s.student.id, s.project.id, { ...input(), url }),
      ).rejects.toThrow("链接");
    }
    await expect(
      createProjectReference(s.student.id, s.project.id, {
        ...input(),
        participantIds: [s.outsider.id],
      }),
    ).rejects.toThrow("当前团队");
    const otherStage = await createMilestone(s.admin.id, s.other.id, {
      title: "其他阶段",
    });
    await expect(
      createProjectReference(s.student.id, s.project.id, {
        ...input(),
        milestoneId: otherStage.id,
      }),
    ).rejects.toThrow("阶段不属于");
    await expect(
      createProjectReference(s.student.id, s.project.id, {
        ...input(),
        type: "document",
      }),
    ).rejects.toThrow("仅用于会议");
    expect(
      (await listProjectReferences(s.admin.id, s.project.id)).items,
    ).toHaveLength(0);
  });
  it("retains meeting history when a stage/member disappears; allows teacher-owned records", async () => {
    const s = await scene();
    const record = await createProjectReference(s.teacher.id, s.project.id, {
      ...input(),
      participantIds: [s.student.id],
      milestoneId: s.stage.id,
    });
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.student.id),
        ),
      );
    const { milestones } = await import("@/db/schema");
    await db.delete(milestones).where(eq(milestones.id, s.stage.id));
    const result = (await listProjectReferences(s.teacher.id, s.project.id))
      .items[0];
    expect(result).toMatchObject({
      milestoneId: null,
      milestoneTitle: "第一阶段",
      participants: [{ id: s.student.id, name: "student" }],
      canEdit: true,
    });
    await deleteProjectReference(s.teacher.id, s.project.id, record.id, 1);
  });
  it("paginates/filters and never leaks other project or team records", async () => {
    const s = await scene();
    await db.insert(projectReferences).values(
      Array.from({ length: 52 }, (_, i) => ({
        projectId: s.project.id,
        createdById: s.student.id,
        title: "文档" + i,
        type: "document" as const,
        url: "https://example.com/" + i,
        requestId: randomUUID(),
        requestHash: "fixture",
      })),
    );
    const first = await listProjectReferences(s.teacher.id, s.project.id, {
      type: "document",
    });
    expect(first.items).toHaveLength(50);
    expect(first.nextOffset).toBe(50);
    const second = await listProjectReferences(s.teacher.id, s.project.id, {
      type: "document",
      offset: 50,
    });
    expect(second.items).toHaveLength(2);
    expect(second.nextOffset).toBeNull();
    expect(
      (
        await listProjectReferences(s.teacher.id, s.project.id, {
          type: "meeting",
        })
      ).items,
    ).toHaveLength(0);
    expect(
      (await listProjectReferences(s.teacher.id, s.other.id)).items,
    ).toHaveLength(0);
    await expect(
      listProjectReferences(s.outsider.id, s.project.id),
    ).rejects.toThrow("没有权限");
  });
  it("keeps archived projects read-only for references and leadership", async () => {
    const s = await scene();
    const r = await createProjectReference(s.student.id, s.project.id, input());
    await updateProject(s.admin.id, s.project.id, { status: "archived" });
    expect(
      (await listProjectReferences(s.student.id, s.project.id)).items[0]
        .canEdit,
    ).toBe(false);
    await expect(
      createProjectReference(s.teacher.id, s.project.id, input()),
    ).rejects.toThrow("归档");
    await expect(
      deleteProjectReference(s.admin.id, s.project.id, r.id, 1),
    ).rejects.toThrow("归档");
    await expect(
      setProjectLeader(s.admin.id, s.project.id, {
        leaderId: s.student.id,
        expectedRevision: 0,
      }),
    ).rejects.toThrow("归档");
  });
  it("keeps create tombstones after deletion and never resurrects a deleted record on retry", async () => {
    const s = await scene(),
      value = input();
    const record = await createProjectReference(
      s.student.id,
      s.project.id,
      value,
    );
    const requestId = randomUUID();
    await deleteProjectReference(
      s.student.id,
      s.project.id,
      record.id,
      1,
      requestId,
    );
    await deleteProjectReference(
      s.student.id,
      s.project.id,
      record.id,
      1,
      requestId,
    );
    await expect(
      createProjectReference(s.student.id, s.project.id, value),
    ).rejects.toThrow("已删除");
    expect(
      (await listProjectReferences(s.student.id, s.project.id)).items,
    ).toHaveLength(0);
  });
  it("retries edits without duplicate revisions and reports reused keys and stale edits as conflicts", async () => {
    const s = await scene(),
      record = await createProjectReference(
        s.student.id,
        s.project.id,
        input(),
      );
    const edit = {
      title: "已修改",
      type: "meeting" as const,
      url: record.url,
      expectedRevision: 1,
      requestId: randomUUID(),
    };
    const first = await updateProjectReference(
      s.student.id,
      s.project.id,
      record.id,
      edit,
    );
    const repeated = await updateProjectReference(
      s.student.id,
      s.project.id,
      record.id,
      edit,
    );
    expect([first.revision, repeated.revision]).toEqual([2, 2]);
    await expect(
      updateProjectReference(s.student.id, s.project.id, record.id, {
        ...edit,
        title: "不同内容",
      }),
    ).rejects.toThrow(ConflictError);
    await expect(
      updateProjectReference(s.student.id, s.project.id, record.id, {
        ...edit,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow(ConflictError);
  });
  it("retries leadership transfer once and rechecks the current admin role", async () => {
    const s = await scene(),
      value = {
        leaderId: s.student.id,
        expectedRevision: 0,
        requestId: randomUUID(),
      };
    const result = await setProjectLeader(s.admin.id, s.project.id, value);
    expect(await setProjectLeader(s.admin.id, s.project.id, value)).toEqual(
      result,
    );
    expect(
      (await getProjectLeadership(s.admin.id, s.project.id)).changes,
    ).toHaveLength(1);
    await db
      .update(teamMembers)
      .set({ role: "student" })
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.admin.id),
        ),
      );
    await expect(
      setProjectLeader(s.admin.id, s.project.id, value),
    ).rejects.toThrow("没有权限");
  });
});
