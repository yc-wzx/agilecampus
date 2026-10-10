import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import {
  personalScheduleState,
  personalScheduleEvents,
  personalScheduleRequests,
  users,
} from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { hashRequest } from "@/lib/write-request";
import {
  addDays,
  eventSchema,
  localInstant,
  preferencesSchema,
  shanghaiDay,
  type ScheduleEventInput,
} from "./types";

export async function lockPersonalState(tx: DbTx, actorId: string) {
  z.uuid().parse(actorId);
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, actorId))
    .for("share");
  if (!user) throw new ForbiddenError();
  await tx
    .insert(personalScheduleState)
    .values({ userId: actorId })
    .onConflictDoNothing();
  const [state] = await tx
    .select()
    .from(personalScheduleState)
    .where(eq(personalScheduleState.userId, actorId))
    .for("update");
  return state;
}
export async function claimPersonalRequest(
  tx: DbTx,
  actorId: string,
  operation: string,
  requestId: string,
  payload: unknown,
) {
  z.uuid().parse(requestId);
  const requestHash = hashRequest(payload);
  const [row] = await tx
    .insert(personalScheduleRequests)
    .values({ userId: actorId, operation, requestId, requestHash })
    .onConflictDoNothing()
    .returning();
  if (row) return { id: row.id, replay: false as const, result: null };
  const [old] = await tx
    .select()
    .from(personalScheduleRequests)
    .where(
      and(
        eq(personalScheduleRequests.userId, actorId),
        eq(personalScheduleRequests.operation, operation),
        eq(personalScheduleRequests.requestId, requestId),
      ),
    );
  if (!old || old.requestHash !== requestHash)
    throw new ConflictError("请求标识已用于不同内容，请刷新后重试");
  return { id: old.id, replay: true as const, result: old.result };
}
export async function finishPersonalRequest<T>(
  tx: DbTx,
  id: string,
  result: T,
) {
  await tx
    .update(personalScheduleRequests)
    .set({ result })
    .where(eq(personalScheduleRequests.id, id));
  return result;
}
function fingerprint(event: ScheduleEventInput) {
  return hashRequest({
    title: event.title,
    startAt: new Date(event.startAt).toISOString(),
    endAt: new Date(event.endAt).toISOString(),
  });
}
export async function getMySchedule(
  actorId: string,
  input: { startDate?: string; endDate?: string; offset?: number } = {},
) {
  z.uuid().parse(actorId);
  const query = z
    .strictObject({
      startDate: z.iso.date().default(shanghaiDay()),
      endDate: z.iso.date().default(addDays(shanghaiDay(), 30)),
      offset: z.number().int().min(0).max(100000).default(0),
    })
    .parse(input);
  if (
    query.startDate > query.endDate ||
    Date.parse(query.endDate) - Date.parse(query.startDate) > 187 * 86400000
  )
    throw new ConflictError("查看范围最长 188 天");
  const [states, rows] = await Promise.all([
    db
      .select()
      .from(personalScheduleState)
      .where(eq(personalScheduleState.userId, actorId)),
    db
      .select()
      .from(personalScheduleEvents)
      .where(
        and(
          eq(personalScheduleEvents.userId, actorId),
          lt(
            personalScheduleEvents.startAt,
            localInstant(addDays(query.endDate, 1)),
          ),
          gt(personalScheduleEvents.endAt, localInstant(query.startDate)),
        ),
      )
      .orderBy(
        asc(personalScheduleEvents.startAt),
        asc(personalScheduleEvents.id),
      )
      .limit(51)
      .offset(query.offset),
  ]);
  return {
    revision: states[0]?.revision ?? 0,
    preferences: preferencesSchema.parse(states[0]?.preferences ?? {}),
    items: rows
      .slice(0, 50)
      .map((row) => ({
        ...row,
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    nextOffset: rows.length > 50 ? query.offset + 50 : null,
  };
}
export async function saveMyPreferences(
  actorId: string,
  input: { requestId: string; expectedRevision: number; preferences: unknown },
) {
  const data = z
    .strictObject({
      requestId: z.uuid(),
      expectedRevision: z.number().int().min(0),
      preferences: preferencesSchema,
    })
    .parse(input);
  return db.transaction(async (tx) => {
    const state = await lockPersonalState(tx, actorId),
      claim = await claimPersonalRequest(
        tx,
        actorId,
        "preferences.save",
        data.requestId,
        data,
      );
    if (claim.replay) return claim.result as { revision: number };
    if (state.revision !== data.expectedRevision)
      throw new ConflictError("课表或偏好已变化，请刷新后保存");
    await tx
      .update(personalScheduleState)
      .set({ preferences: data.preferences, revision: state.revision + 1 })
      .where(eq(personalScheduleState.userId, actorId));
    return finishPersonalRequest(tx, claim.id, {
      revision: state.revision + 1,
    });
  });
}
export async function importMySchedule(
  actorId: string,
  input: {
    requestId: string;
    events: ScheduleEventInput[];
    source: "ics" | "csv" | "manual";
  },
) {
  const data = z
    .strictObject({
      requestId: z.uuid(),
      events: z.array(eventSchema).min(1).max(1000),
      source: z.enum(["ics", "csv", "manual"]),
    })
    .parse(input);
  return db.transaction(async (tx) => {
    const state = await lockPersonalState(tx, actorId),
      claim = await claimPersonalRequest(
        tx,
        actorId,
        "events.import",
        data.requestId,
        data,
      );
    if (claim.replay)
      return claim.result as {
        added: number;
        skipped: number;
        revision: number;
      };
    const values = [
      ...new Map(
        data.events.map((event) => [fingerprint(event), event]),
      ).entries(),
    ].map(([key, event]) => ({
      userId: actorId,
      title: event.title,
      startAt: new Date(event.startAt),
      endAt: new Date(event.endAt),
      fingerprint: key,
      source: data.source,
    }));
    const inserted = await tx
      .insert(personalScheduleEvents)
      .values(values)
      .onConflictDoNothing({
        target: [
          personalScheduleEvents.userId,
          personalScheduleEvents.fingerprint,
        ],
      })
      .returning({ id: personalScheduleEvents.id });
    if (inserted.length)
      await tx
        .update(personalScheduleState)
        .set({ revision: state.revision + 1 })
        .where(eq(personalScheduleState.userId, actorId));
    return finishPersonalRequest(tx, claim.id, {
      added: inserted.length,
      skipped: data.events.length - inserted.length,
      revision: state.revision + (inserted.length ? 1 : 0),
    });
  });
}
export async function changeMyEvent(
  actorId: string,
  id: string,
  input: {
    requestId: string;
    expectedRevision: number;
    event?: ScheduleEventInput;
  },
) {
  z.uuid().parse(id);
  const data = z
    .strictObject({
      requestId: z.uuid(),
      expectedRevision: z.number().int().positive(),
      event: eventSchema.optional(),
    })
    .parse(input);
  return db.transaction(async (tx) => {
    const state = await lockPersonalState(tx, actorId),
      claim = await claimPersonalRequest(
        tx,
        actorId,
        data.event ? "event.update" : "event.delete",
        data.requestId,
        { id, ...data },
      );
    if (claim.replay) return claim.result as { id: string };
    const [row] = await tx
      .select()
      .from(personalScheduleEvents)
      .where(
        and(
          eq(personalScheduleEvents.id, id),
          eq(personalScheduleEvents.userId, actorId),
        ),
      )
      .for("update");
    if (!row) throw new NotFoundError();
    if (row.revision !== data.expectedRevision)
      throw new ConflictError("日程已变化，请刷新核对");
    if (data.event) {
      const key = fingerprint(data.event);
      const [duplicate] = await tx
        .select({ id: personalScheduleEvents.id })
        .from(personalScheduleEvents)
        .where(
          and(
            eq(personalScheduleEvents.userId, actorId),
            eq(personalScheduleEvents.fingerprint, key),
          ),
        );
      if (duplicate && duplicate.id !== id)
        throw new ConflictError("已有相同的日程");
      await tx
        .update(personalScheduleEvents)
        .set({
          title: data.event.title,
          startAt: new Date(data.event.startAt),
          endAt: new Date(data.event.endAt),
          fingerprint: key,
          revision: row.revision + 1,
        })
        .where(eq(personalScheduleEvents.id, id));
    } else
      await tx
        .delete(personalScheduleEvents)
        .where(eq(personalScheduleEvents.id, id));
    await tx
      .update(personalScheduleState)
      .set({ revision: state.revision + 1 })
      .where(eq(personalScheduleState.userId, actorId));
    return finishPersonalRequest(tx, claim.id, { id });
  });
}
export async function personalBusy(
  tx: DbTx,
  actorId: string,
  startDate: string,
  endDate: string,
) {
  return tx
    .select({
      startAt: personalScheduleEvents.startAt,
      endAt: personalScheduleEvents.endAt,
    })
    .from(personalScheduleEvents)
    .where(
      and(
        eq(personalScheduleEvents.userId, actorId),
        lt(personalScheduleEvents.startAt, localInstant(addDays(endDate, 1))),
        gt(personalScheduleEvents.endAt, localInstant(startDate)),
      ),
    )
    .orderBy(asc(personalScheduleEvents.startAt))
    .limit(2001);
}
export async function purgeOldPersonalClaims(tx: DbTx, actorId: string) {
  // Only abandoned generation leases; ordinary idempotency receipts remain intact.
  await tx
    .delete(personalScheduleRequests)
    .where(
      and(
        eq(personalScheduleRequests.userId, actorId),
        eq(personalScheduleRequests.operation, "plan.generate"),
        sql`${personalScheduleRequests.result}->>'draftId' is null`,
        sql`(${personalScheduleRequests.result}->>'expiresAt')::bigint < ${Date.now() - 86400000}`,
      ),
    );
}
