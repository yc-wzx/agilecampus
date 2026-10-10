import ical from "ical-generator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { readProject } from "./project-read";
import { projects, tasks, milestones, teamMembers } from "@/db/schema";
import { ForbiddenError, AppError } from "./errors";

const date = z.iso.date();
export function createDeadlineCalendar(
  project: { id: string; name: string; endDate: string | null },
  projectMilestones: {
    id: string;
    title: string;
    targetDate: string | null;
    status: string;
  }[],
  projectTasks: {
    id: string;
    title: string;
    dueDate: string | null;
    status: string;
  }[],
  origin: string,
) {
  const base = new URL(origin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw new AppError("网站地址配置不正确");
  const calendar = ical({
    name: project.name + " · 截止日期",
    prodId: { company: "AgileCampus", product: "Deadlines", language: "ZH" },
  });
  let count = 0;
  function add(
    kind: string,
    id: string,
    title: string,
    deadline: string | null,
    state: string,
    path: string,
  ) {
    if (!deadline || !date.safeParse(deadline).success) return;
    const start = new Date(deadline + "T00:00:00.000Z");
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    calendar.createEvent({
      id: kind + "-" + id + "@agilecampus",
      start,
      end,
      allDay: true,
      summary: title,
      description:
        "项目：" +
        project.name +
        "\n" +
        state +
        "\n此文件为导出时的快照，网站修改后请重新导出。",
      url: new URL(path, base.origin).href,
    });
    count++;
  }
  const path = "/projects/" + project.id;
  add(
    "project",
    project.id,
    "项目截止：" + project.name,
    project.endDate,
    "项目截止日期",
    path,
  );
  for (const m of projectMilestones)
    add(
      "milestone",
      m.id,
      "阶段截止：" + m.title,
      m.targetDate,
      m.status === "done" ? "阶段已完成" : "阶段未完成",
      path,
    );
  for (const t of projectTasks) {
    const label =
      { todo: "待做", doing: "进行中", done: "已完成" }[t.status] ?? t.status;
    add(
      "task",
      t.id,
      "任务截止：" + t.title,
      t.dueDate,
      "任务状态：" + label,
      path + "?task=" + t.id,
    );
  }
  return { content: calendar.toString(), count };
}

export async function exportProjectCalendar(
  actorId: string,
  projectId: string,
  origin: string,
) {
  if (
    !z.uuid().safeParse(actorId).success ||
    !z.uuid().safeParse(projectId).success
  )
    throw new ForbiddenError();
  return readProject(actorId, projectId, async (tx) => {
    const [project] = await tx
      .select({
        id: projects.id,
        name: projects.name,
        endDate: projects.endDate,
      })
      .from(projects)
      .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
      .where(and(eq(projects.id, projectId), eq(teamMembers.userId, actorId)));
    if (!project) throw new ForbiddenError();
    const [ms, ts] = await Promise.all([
      tx
        .select({
          id: milestones.id,
          title: milestones.title,
          targetDate: milestones.targetDate,
          status: milestones.status,
        })
        .from(milestones)
        .where(eq(milestones.projectId, projectId)),
      tx
        .select({
          id: tasks.id,
          title: tasks.title,
          dueDate: tasks.dueDate,
          status: tasks.status,
        })
        .from(tasks)
        .where(eq(tasks.projectId, projectId)),
    ]);
    return createDeadlineCalendar(project, ms, ts, origin);
  });
}
