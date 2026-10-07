import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { deliverableOutbox, projects, teamMembers } from "@/db/schema";

export type DeliverableEvent = typeof deliverableOutbox.$inferSelect;

// Call within the business transaction; no external request is made here.
export async function recordDeliverableEvent(tx: DbTx, input: {
  eventKey: string; projectId: string; actorId: string; type: string;
  payload: Record<string, string>; recipients: "reviewers" | "members" | string[];
}) {
  const members = await tx.select({ userId: teamMembers.userId, role: teamMembers.role })
    .from(teamMembers).innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
    .where(eq(projects.id, input.projectId));
  const recipientIds = members.filter((m) => m.userId !== input.actorId && (
    input.recipients === "members" || (input.recipients === "reviewers" ? m.role !== "student" : input.recipients.includes(m.userId))
  )).map((m) => m.userId);
  await tx.insert(deliverableOutbox).values({
    eventKey: input.eventKey, projectId: input.projectId, actorId: input.actorId,
    type: input.type, payload: input.payload, recipientIds,
  }).onConflictDoNothing({ target: deliverableOutbox.eventKey });
}

// Server-only E/F integration, never expose as a user Action. Sink must deduplicate
// eventKey and atomically save activity + notification intent, then send externally.
// A crash after sink success can replay an event (at-least-once delivery).
export async function dispatchDeliverableEvents(sink: (event: DeliverableEvent) => Promise<void>, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid dispatch limit");
  const result = { delivered: 0, failed: 0 };
  const visited: string[] = [];
  for (let i = 0; i < limit; i++) {
    const outcome = await db.transaction(async (tx) => {
      const [event] = await tx.select().from(deliverableOutbox)
        .where(and(isNull(deliverableOutbox.deliveredAt), visited.length ? notInArray(deliverableOutbox.id, visited) : undefined))
        .orderBy(asc(deliverableOutbox.createdAt), asc(deliverableOutbox.id)).limit(1).for("update", { skipLocked: true });
      if (!event) return "empty";
      visited.push(event.id);
      const members = event.recipientIds.length ? await tx.select({ id: teamMembers.userId, role: teamMembers.role })
        .from(teamMembers).innerJoin(projects, eq(projects.teamId, teamMembers.teamId))
        .where(and(eq(projects.id, event.projectId), inArray(teamMembers.userId, event.recipientIds))) : [];
      try { await sink({ ...event, recipientIds: members.filter((m) => event.type !== "deliverable.submitted" || m.role !== "student").map((m) => m.id) }); }
      catch { return "failed"; }
      await tx.update(deliverableOutbox).set({ deliveredAt: new Date() }).where(eq(deliverableOutbox.id, event.id));
      return "delivered";
    });
    if (outcome === "empty") break;
    result[outcome]++;
  }
  return result;
}
