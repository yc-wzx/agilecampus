import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { projects, teamMembers } from "@/db/schema";
import { getMyOpenTasks, groupMyTasks, todayInShanghai } from "./dashboard";
import { listMyActiveIterations, getCurrentIteration } from "./iteration";
import {
  listMyRevisionRequiredDeliverables,
  getProjectDeliverableStats,
} from "./deliverable-reporting";
import { getProjectTaskStats } from "./task-contract";
import { getUnreadNotificationCount } from "./notification";
import { listProjectActivities } from "./activity";
import { listProjectRisks } from "./risk";
import { ForbiddenError, NotFoundError } from "./errors";
import { normalizePage, pageResult } from "./pagination";
import type {
  PageInput,
  QueryPart,
  TeacherProjectOverview,
} from "@/contracts/p0-p2";
export type RevisionRequiredItem = Awaited<
  ReturnType<typeof listMyRevisionRequiredDeliverables>
>["items"][number];
export type WorkspaceSummaryOptions = {
  revisionsOffset?: number;
  iterationsOffset?: number;
  iterations?: PageInput;
  revisions?: PageInput;
};
export type MyWorkspaceSummary = Awaited<
  ReturnType<typeof getMyWorkspaceSummary>
>;

export async function getTeacherOverviewAccess(actorId: string) {
  z.uuid().parse(actorId);
  const [member] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, actorId),
        inArray(teamMembers.role, ["admin", "teacher"]),
      ),
    )
    .limit(1);
  return !!member;
}
async function part<T>(
  name: string,
  run: () => Promise<T>,
): Promise<QueryPart<T>> {
  try {
    return { state: "ready", data: await run() };
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError)
      throw error;
    console.error(
      "[workspace]",
      name,
      error instanceof Error ? error.name : "UnknownError",
    );
    return {
      state: "unavailable",
      code: "INTERNAL",
      message: `${name}加载失败`,
    };
  }
}
export async function getMyWorkspaceSummary(
  actorId: string,
  paging: WorkspaceSummaryOptions = {},
) {
  z.uuid().parse(actorId);
  const safeOffset = (value: number | undefined) =>
    Number.isSafeInteger(value) && (value ?? 0) >= 0 ? value! : 0;
  const [tasks, activeIterations, revisionRequired, unread] = await Promise.all(
    [
      part("任务", async () =>
        groupMyTasks(await getMyOpenTasks(actorId), todayInShanghai()),
      ),
      part("当前迭代", () =>
        listMyActiveIterations(
          actorId,
          paging.iterations ?? {
            offset: safeOffset(paging.iterationsOffset),
            limit: 50,
          },
        ),
      ),
      part("待修改成果", () =>
        listMyRevisionRequiredDeliverables(
          actorId,
          paging.revisions ?? {
            offset: safeOffset(paging.revisionsOffset),
            limit: 50,
          },
        ),
      ),
      part("未读通知", () => getUnreadNotificationCount(actorId)),
    ],
  );
  return {
    tasks,
    activeIterations,
    revisionRequired,
    unread,
    asOf: new Date().toISOString(),
  };
}
export async function listTeacherProjectOverview(
  actorId: string,
  filters: PageInput & { includeArchived?: boolean } = {},
) {
  z.uuid().parse(actorId);
  const data = z
    .strictObject({
      offset: z.number().int().min(0).max(100000).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      includeArchived: z.boolean().optional(),
    })
    .parse(filters);
  const { offset, limit } = normalizePage(data);
  const where = and(
    eq(teamMembers.userId, actorId),
    inArray(teamMembers.role, ["admin", "teacher"]),
    data.includeArchived ? undefined : ne(projects.status, "archived"),
  );
  const [count] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(projects)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(where);
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
    .where(where)
    .orderBy(asc(projects.name), projects.id)
    .offset(offset)
    .limit(limit);
  const items: TeacherProjectOverview[] = [];
  for (const project of rows) {
    // Authorize the aggregation itself, even if a member was demoted after the page query.
    const [access] = await db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
      .where(
        and(
          eq(projects.id, project.id),
          eq(teamMembers.userId, actorId),
          inArray(teamMembers.role, ["admin", "teacher"]),
        ),
      );
    if (!access) throw new ForbiddenError();
    const [taskStats, activeIteration, deliverableStats, lastActivity, risks] =
      await Promise.all([
        part("任务统计", () => getProjectTaskStats(actorId, project.id)),
        part("当前迭代", () => getCurrentIteration(actorId, project.id)),
        part("成果统计", () => getProjectDeliverableStats(actorId, project.id)),
        part(
          "最近动态",
          async () =>
            (await listProjectActivities(actorId, project.id, { limit: 1 }))
              .items[0] ?? null,
        ),
        part("风险", () => listProjectRisks(actorId, project.id)),
      ]);
    const pendingItems =
      deliverableStats.state === "ready"
        ? {
            state: "ready" as const,
            data: {
              submittedCount: deliverableStats.data.byStatus.submitted,
              changesRequestedCount:
                deliverableStats.data.byStatus.changes_requested,
              sourceHref: `/projects/${project.id}/deliverables`,
            },
          }
        : deliverableStats;
    const [stillStaff] = await db
      .select({ id: projects.id })
      .from(projects)
      .innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
      .where(
        and(
          eq(projects.id, project.id),
          eq(teamMembers.userId, actorId),
          inArray(teamMembers.role, ["admin", "teacher"]),
        ),
      );
    if (!stillStaff) throw new ForbiddenError();
    items.push({
      projectId: project.id,
      projectName: project.name,
      taskStats,
      activeIteration,
      deliverableStats,
      lastActivity,
      risks,
      pendingItems,
      asOf: new Date().toISOString(),
    });
  }
  return pageResult(items, count.total, offset, limit);
}
