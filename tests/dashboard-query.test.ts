import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teamMembers } from "@/db/schema";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject, updateProject } from "@/lib/project";
import { createTask, updateTask } from "@/lib/task";
import { getMyOpenTasks } from "@/lib/dashboard";
import { resetDb } from "./helpers";

async function scene() {
  const owner = await createUser({ name: "组长", email: "owner@dashboard.test", password: "password123" });
  const student = await createUser({ name: "同学", email: "student@dashboard.test", password: "password123" });
  const other = await createUser({ name: "另一位", email: "other@dashboard.test", password: "password123" });
  const team = await createTeam(owner.id, "课程团队");
  await joinTeam(student.id, team.inviteCode);
  await joinTeam(other.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "课程项目" });
  return { owner, student, other, team, project };
}

describe("dashboard database permissions and scope", () => {
  beforeEach(resetDb);

  it("only returns the current user's unfinished assignments with real project and team names", async () => {
    const { owner, student, other, project } = await scene();
    const mine = await createTask(owner.id, project.id, { title: "本人任务", assigneeId: student.id, dueDate: "2026-10-05" });
    const done = await createTask(owner.id, project.id, { title: "已完成", assigneeId: student.id });
    await updateTask(owner.id, done.id, { status: "done" });
    await createTask(owner.id, project.id, { title: "未指派" });
    await createTask(owner.id, project.id, { title: "别人的任务", assigneeId: other.id });
    const items = await getMyOpenTasks(student.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: mine.id, teamName: "课程团队", projectName: "课程项目", dueDate: "2026-10-05" });
  });

  it("leaving the team hides previously assigned tasks even when the assignee stays unchanged", async () => {
    const { owner, student, team, project } = await scene();
    await createTask(owner.id, project.id, { title: "离队前任务", assigneeId: student.id });
    expect(await getMyOpenTasks(student.id)).toHaveLength(1);
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, student.id)));
    expect(await getMyOpenTasks(student.id)).toEqual([]);
  });

  it("archived projects disappear from daily work and return after reopening", async () => {
    const { owner, student, project } = await scene();
    await createTask(owner.id, project.id, { title: "历史任务", assigneeId: student.id });
    await updateProject(owner.id, project.id, { status: "archived" });
    expect(await getMyOpenTasks(student.id)).toEqual([]);
    await updateProject(owner.id, project.id, { status: "active" });
    expect(await getMyOpenTasks(student.id)).toHaveLength(1);
  });

  it("aggregates accessible teams without returning another member's assignments", async () => {
    const { owner, student, other, project } = await scene();
    const second = await createTeam(other.id, "另一个课程团队");
    await joinTeam(student.id, second.inviteCode);
    const secondProject = await createProject(other.id, second.id, { name: "第二项目" });
    const a = await createTask(owner.id, project.id, { title: "任务甲", assigneeId: student.id });
    const b = await createTask(other.id, secondProject.id, { title: "任务乙", assigneeId: student.id });
    await createTask(other.id, secondProject.id, { title: "他人任务", assigneeId: other.id });
    expect((await getMyOpenTasks(student.id)).map((task) => task.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("keeps assigned subtasks, independently of their parent's assignment", async () => {
    const { owner, student, other, project } = await scene();
    const parent = await createTask(owner.id, project.id, { title: "父任务", assigneeId: other.id });
    const child = await createTask(owner.id, project.id, { title: "本人子任务", parentTaskId: parent.id, assigneeId: student.id });
    expect((await getMyOpenTasks(student.id)).map((task) => task.id)).toEqual([child.id]);
  });

  it("returns no data for a user without any memberships", async () => {
    const stranger = await createUser({ name: "未入队", email: "stranger@dashboard.test", password: "password123" });
    expect(await getMyOpenTasks(stranger.id)).toEqual([]);
  });
});
