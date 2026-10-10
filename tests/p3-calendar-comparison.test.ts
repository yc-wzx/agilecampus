import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { users, teamMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask } from "@/lib/task";
import {
  createDeadlineCalendar,
  exportProjectCalendar,
} from "@/lib/project-calendar";
import {
  compareText,
  getDeliverableComparison,
} from "@/lib/deliverable-comparison";
import {
  createDeliverableDraft,
  submitDeliverable,
  reviewDeliverable,
  startDeliverableRevision,
  updateDeliverableDraft,
  getDeliverableDetail,
} from "@/lib/deliverable";
import { resetDb } from "./helpers";
const mocked = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocked.auth }));
import { GET } from "@/app/api/projects/[projectId]/calendar/route";

async function scene() {
  const [admin, student, teacher, outsider] = await db
    .insert(users)
    .values(
      ["admin", "student", "teacher", "outsider"].map((name) => ({
        name,
        email: name + "@p3-calendar.test",
        passwordHash: "fixture",
      })),
    )
    .returning();
  const team = await createTeam(admin.id, "日历团队");
  for (const member of [student, teacher])
    await joinTeam(member.id, team.inviteCode);
  await updateMemberRole(admin.id, team.id, teacher.id, "teacher");
  const project = await createProject(admin.id, team.id, {
    name: "课程项目",
    endDate: "2026-11-01",
  });
  return { admin, student, teacher, outsider, team, project };
}
beforeEach(async () => {
  mocked.auth.mockReset();
  await resetDb();
});

describe("P3 deadline calendar", () => {
  it("exports all-day Chinese dates with exclusive next-day end, stable IDs and escaped text", () => {
    const project = {
      id: randomUUID(),
      name: "中文项目",
      endDate: "2026-10-03",
    };
    const task = {
      id: randomUUID(),
      title: "完成调研\nEND:VEVENT",
      dueDate: "2026-10-04",
      status: "todo",
    };
    const result = createDeadlineCalendar(
      project,
      [],
      [task],
      "https://campus.example.com",
    );
    const normalized = result.content.replace(/\r\n /g, "");
    expect(result.count).toBe(2);
    expect(normalized).toContain("DTSTART;VALUE=DATE:20261003");
    expect(normalized).toContain("DTEND;VALUE=DATE:20261004");
    expect(normalized).toContain("UID:task-" + task.id + "@agilecampus");
    expect(normalized.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(normalized).toContain("完成调研");
    expect(normalized).toContain("https://campus.example.com/projects/");
    expect(
      createDeadlineCalendar(project, [], [task], "https://campus.example.com")
        .content,
    ).toContain("UID:task-" + task.id + "@agilecampus");
  });
  it("supports leap dates and empty calendars without inventing missing/invalid dates", () => {
    const result = createDeadlineCalendar(
      { id: "p", name: "无日期", endDate: null },
      [],
      [
        { id: "t1", title: "闰年", dueDate: "2028-02-29", status: "done" },
        { id: "t2", title: "错误日期", dueDate: "2026-02-30", status: "todo" },
        { id: "t3", title: "没日期", dueDate: null, status: "todo" },
      ],
      "http://localhost:3000",
    );
    expect(result.count).toBe(1);
    expect(result.content).toContain("DTEND;VALUE=DATE:20280301");
    expect(
      createDeadlineCalendar(
        { id: "p", name: "空", endDate: null },
        [],
        [],
        "http://localhost:3000",
      ).count,
    ).toBe(0);
  });
  it("exports only authorized project data and rejects access after leaving", async () => {
    const s = await scene();
    await createMilestone(s.admin.id, s.project.id, {
      title: "中期",
      targetDate: "2026-10-15",
    });
    await createTask(s.student.id, s.project.id, {
      title: "站内任务",
      dueDate: "2026-10-10",
    });
    const other = await createProject(s.admin.id, s.team.id, {
      name: "不能混入",
      endDate: "2026-12-01",
    });
    await createTask(s.student.id, other.id, {
      title: "其他项目任务",
      dueDate: "2026-10-10",
    });
    const result = await exportProjectCalendar(
      s.teacher.id,
      s.project.id,
      "http://localhost:3000",
    );
    expect(result.count).toBe(3);
    expect(result.content).not.toContain("不能混入");
    await expect(
      exportProjectCalendar(
        s.outsider.id,
        s.project.id,
        "http://localhost:3000",
      ),
    ).rejects.toThrow("没有权限");
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, s.team.id),
          eq(teamMembers.userId, s.student.id),
        ),
      );
    await expect(
      exportProjectCalendar(
        s.student.id,
        s.project.id,
        "http://localhost:3000",
      ),
    ).rejects.toThrow("没有权限");
  });
  it("HTTP download checks login, denies other teams, and disables caching", async () => {
    const s = await scene();
    const request = new Request(
      "http://localhost:3000/api/projects/" + s.project.id + "/calendar",
    );
    const context = { params: Promise.resolve({ projectId: s.project.id }) };
    mocked.auth.mockResolvedValue(null);
    expect((await GET(request, context)).status).toBe(401);
    mocked.auth.mockResolvedValue({ user: { id: s.outsider.id } });
    expect((await GET(request, context)).status).toBe(403);
    mocked.auth.mockResolvedValue({ user: { id: s.student.id } });
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toContain("text/calendar");
    expect(response.headers.get("Content-Disposition")).toContain(".ics");
    expect(await response.text()).toContain("BEGIN:VCALENDAR");
  });
});

describe("P3 deliverable version comparison", () => {
  it("compares Chinese and identical text without interpreting HTML", () => {
    const change = compareText("访谈了3位同学", "访谈了8位同学");
    expect(
      change.changes
        .filter((c) => c.added)
        .map((c) => c.value)
        .join(""),
    ).toBe("8");
    expect(
      change.changes
        .filter((c) => c.removed)
        .map((c) => c.value)
        .join(""),
    ).toBe("3");
    expect(compareText("", "").changes).toEqual([]);
    expect(
      compareText("<script>x</script>", "<script>x</script>").changes.every(
        (c) => !c.added && !c.removed,
      ),
    ).toBe(true);
  });
  it("compares immutable submitted snapshots, including links; rejects foreign versions and outsiders", async () => {
    const s = await scene();
    const draft = await createDeliverableDraft(s.student.id, s.project.id, {
      title: "调研报告",
      type: "report",
      url: "https://example.com/v1",
      description: "访谈3人",
      requestId: randomUUID(),
    });
    const v1 = await submitDeliverable(s.student.id, s.project.id, draft.id, {
      requestId: randomUUID(),
      expectedRevision: draft.revision,
    });
    const reviewed = await reviewDeliverable(
      s.teacher.id,
      s.project.id,
      draft.id,
      {
        requestId: randomUUID(),
        versionId: v1.versionId,
        decision: "changes_requested",
        comment: "增加样本",
      },
    );
    const working = await startDeliverableRevision(
      s.student.id,
      s.project.id,
      draft.id,
      {
        requestId: randomUUID(),
        expectedRevision: reviewed.deliverable.revision,
      },
    );
    const edited = await updateDeliverableDraft(
      s.student.id,
      s.project.id,
      draft.id,
      {
        title: "调研报告",
        type: "report",
        url: "https://example.com/v2",
        description: "访谈8人",
        expectedRevision: working.revision,
      },
    );
    const v2 = await submitDeliverable(s.student.id, s.project.id, draft.id, {
      requestId: randomUUID(),
      expectedRevision: edited.revision,
    });
    const result = await getDeliverableComparison(
      s.teacher.id,
      s.project.id,
      draft.id,
      v1.versionId,
      v2.versionId,
    );
    expect(result).toMatchObject({
      changed: true,
      links: { changed: true },
      from: { number: 1 },
      to: { number: 2 },
    });
    expect(
      result.description.changes
        .filter((c) => c.added)
        .map((c) => c.value)
        .join(""),
    ).toBe("8");
    expect(
      (await getDeliverableDetail(s.student.id, s.project.id, draft.id))
        .versions[1].description,
    ).toBe("访谈3人");
    expect(
      (
        await getDeliverableComparison(
          s.teacher.id,
          s.project.id,
          draft.id,
          v1.versionId,
          v1.versionId,
        )
      ).changed,
    ).toBe(false);
    await expect(
      getDeliverableComparison(
        s.outsider.id,
        s.project.id,
        draft.id,
        v1.versionId,
        v2.versionId,
      ),
    ).rejects.toThrow("没有权限");
    await expect(
      getDeliverableComparison(
        s.teacher.id,
        s.project.id,
        draft.id,
        v1.versionId,
        randomUUID(),
      ),
    ).rejects.toThrow("同一成果");
    const approved = await reviewDeliverable(
      s.teacher.id,
      s.project.id,
      draft.id,
      {
        requestId: randomUUID(),
        versionId: v2.versionId,
        decision: "approved",
      },
    );
    const secretDraft = await startDeliverableRevision(
      s.student.id,
      s.project.id,
      draft.id,
      {
        requestId: randomUUID(),
        expectedRevision: approved.deliverable.revision,
      },
    );
    await updateDeliverableDraft(s.student.id, s.project.id, draft.id, {
      title: "私密未提交",
      type: "report",
      url: "https://example.com/private",
      description: "不能泄露",
      expectedRevision: secretDraft.revision,
    });
    expect(
      JSON.stringify(
        await getDeliverableComparison(
          s.teacher.id,
          s.project.id,
          draft.id,
          v1.versionId,
          v2.versionId,
        ),
      ),
    ).not.toContain("不能泄露");
  });
});
