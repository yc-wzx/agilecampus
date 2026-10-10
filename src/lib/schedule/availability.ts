import { and, asc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  personalScheduleEvents,
  personalScheduleState,
  personalWorkPlans,
  projects,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  claimPersonalRequest,
  finishPersonalRequest,
  lockPersonalState,
} from "./store";
import {
  addDays,
  localInstant,
  shanghaiDay,
  type BusyPeriod,
  type WorkBlock,
} from "./types";

export async function saveScheduleSharing(
  actorId: string,
  input: {
    requestId: string;
    expectedRevision: number;
    teamIds: string[];
    shareWorkPlans: boolean;
  },
) {
  const data = z
    .strictObject({
      requestId: z.uuid(),
      expectedRevision: z.number().int().min(0),
      teamIds: z.array(z.uuid()).max(50),
      shareWorkPlans: z.boolean(),
    })
    .parse(input);
  if (new Set(data.teamIds).size !== data.teamIds.length)
    throw new ValidationError("团队不能重复");
  return db.transaction(async (tx) => {
    // Lock memberships before personal state, matching team/project writes.
    if (data.teamIds.length) {
      const membership = await tx
        .select({ teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(
          and(
            eq(teamMembers.userId, actorId),
            inArray(teamMembers.teamId, data.teamIds),
          ),
        )
        .for("share");
      if (membership.length !== data.teamIds.length)
        throw new ForbiddenError("只能向自己当前所在的团队共享");
    }
    const state = await lockPersonalState(tx, actorId);
    const claim = await claimPersonalRequest(
      tx,
      actorId,
      "sharing.save",
      data.requestId,
      data,
    );
    if (claim.replay) return claim.result as { revision: number };
    if (state.sharingRevision !== data.expectedRevision)
      throw new ConflictError("共享设置已变化，请刷新后重试");
    await tx
      .update(personalScheduleState)
      .set({
        sharedTeamIds: data.teamIds,
        shareWorkPlans: data.shareWorkPlans,
        sharingRevision: state.sharingRevision + 1,
      })
      .where(eq(personalScheduleState.userId, actorId));
    return finishPersonalRequest(tx, claim.id, {
      revision: state.sharingRevision + 1,
    });
  });
}

// Round outwards and merge touching blocks. Never expose source boundaries,
// titles, event IDs, project IDs, goals or reasons through the shared DTO.
export function fuzzyBusy(
  periods: BusyPeriod[],
  start: number,
  end: number,
): BusyPeriod[] {
  const unit = 30 * 60000;
  const blocks = periods
    .map((p) => ({
      start: Math.max(start, Math.floor(Date.parse(p.startAt) / unit) * unit),
      end: Math.min(end, Math.ceil(Date.parse(p.endAt) / unit) * unit),
    }))
    .filter(
      (p) =>
        Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start,
    )
    .sort((a, b) => a.start - b.start);
  const merged: typeof blocks = [];
  for (const p of blocks) {
    const previous = merged.at(-1);
    if (previous && p.start <= previous.end)
      previous.end = Math.max(previous.end, p.end);
    else merged.push({ ...p });
  }
  return merged.map((p) => ({
    startAt: new Date(p.start).toISOString(),
    endAt: new Date(p.end).toISOString(),
  }));
}

export async function getTeamAvailability(
  actorId: string,
  teamId: string,
  input: { startDate?: string; days?: 7 | 14 } = {},
) {
  z.uuid().parse(actorId);
  z.uuid().parse(teamId);
  const query = z
    .strictObject({
      startDate: z.iso.date().default(shanghaiDay()),
      days: z.union([z.literal(7), z.literal(14)]).default(7),
    })
    .parse(input);
  const endDate = addDays(query.startDate, query.days - 1),
    start = localInstant(query.startDate),
    end = localInstant(addDays(endDate, 1));
  return db.transaction(
    async (tx) => {
      const [access] = await tx
        .select({ id: teams.id, name: teams.name })
        .from(teams)
        .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
        .where(and(eq(teams.id, teamId), eq(teamMembers.userId, actorId)))
        .for("share", { of: [teams, teamMembers] });
      if (!access) throw new ForbiddenError("团队不存在或你已不在该团队");
      const members = await tx
        .select({ id: users.id, name: users.name, role: teamMembers.role })
        .from(teamMembers)
        .innerJoin(users, eq(users.id, teamMembers.userId))
        .where(eq(teamMembers.teamId, teamId))
        .orderBy(asc(users.name), asc(users.id))
        .limit(101)
        .for("share", { of: [teamMembers] });
      if (members.length > 100)
        throw new ValidationError("团队人数超过当前日程视图支持范围");
      const states = await tx
        .select()
        .from(personalScheduleState)
        .where(
          inArray(
            personalScheduleState.userId,
            members.map((m) => m.id),
          ),
        )
        .for("share");
      const shared = states.filter((s) => s.sharedTeamIds.includes(teamId));
      const sharedIds = shared.map((s) => s.userId),
        planIds = shared.filter((s) => s.shareWorkPlans).map((s) => s.userId);
      const events = sharedIds.length
        ? await tx
            .select({
              userId: personalScheduleEvents.userId,
              startAt: personalScheduleEvents.startAt,
              endAt: personalScheduleEvents.endAt,
            })
            .from(personalScheduleEvents)
            .where(
              and(
                inArray(personalScheduleEvents.userId, sharedIds),
                eq(personalScheduleEvents.shareBusy, true),
                lt(personalScheduleEvents.startAt, end),
                gt(personalScheduleEvents.endAt, start),
              ),
            )
            .orderBy(personalScheduleEvents.id)
            .limit(5001)
        : [];
      // Only plans belonging to this team contribute. Private project metadata is never returned.
      const plans = planIds.length
        ? await tx
            .select({
              userId: personalWorkPlans.userId,
              items: personalWorkPlans.items,
            })
            .from(personalWorkPlans)
            .innerJoin(projects, eq(projects.id, personalWorkPlans.projectId))
            .where(
              and(
                inArray(personalWorkPlans.userId, planIds),
                eq(projects.teamId, teamId),
                eq(personalWorkPlans.status, "confirmed"),
                lte(personalWorkPlans.startDate, endDate),
                gte(personalWorkPlans.endDate, query.startDate),
              ),
            )
            .orderBy(personalWorkPlans.id)
            .limit(501)
        : [];
      if (events.length > 5000 || plans.length > 500)
        throw new ValidationError(
          "日程数量过多，请缩小范围；不能用截断数据判断空闲",
        );
      return {
        team: access,
        startDate: query.startDate,
        endDate,
        timeZone: "Asia/Shanghai",
        members: members.map((m) => ({
          ...m,
          sharingEnabled: sharedIds.includes(m.id),
          periods: fuzzyBusy(
            [
              ...events
                .filter((e) => e.userId === m.id)
                .map((e) => ({
                  startAt: e.startAt.toISOString(),
                  endAt: e.endAt.toISOString(),
                })),
              ...plans
                .filter((p) => p.userId === m.id)
                .flatMap((p) =>
                  (p.items as WorkBlock[]).map((b) => ({
                    startAt: b.startAt,
                    endAt: b.endAt,
                  })),
                ),
            ],
            start.getTime(),
            end.getTime(),
          ),
        })),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

export async function getMyPlansNeedingReview(actorId: string) {
  return db
    .select({
      id: personalWorkPlans.id,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(personalWorkPlans)
    .innerJoin(projects, eq(projects.id, personalWorkPlans.projectId))
    .innerJoin(
      teamMembers,
      and(
        eq(teamMembers.teamId, projects.teamId),
        eq(teamMembers.userId, actorId),
      ),
    )
    .innerJoin(personalScheduleState, eq(personalScheduleState.userId, actorId))
    .where(
      and(
        eq(personalWorkPlans.userId, actorId),
        eq(personalWorkPlans.status, "confirmed"),
        gte(personalWorkPlans.endDate, shanghaiDay()),
        lt(personalWorkPlans.scheduleRevision, personalScheduleState.revision),
      ),
    )
    .orderBy(personalWorkPlans.createdAt)
    .limit(100);
}
