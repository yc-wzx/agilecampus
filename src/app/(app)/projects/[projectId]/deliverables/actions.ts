"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";
import {
  createDeliverableDraft, updateDeliverableDraft, submitDeliverable,
  listProjectDeliverables, getDeliverableDetail, DeliverableError,
  type CreateDeliverableInput, type UpdateDeliverableInput, type SubmitDeliverableInput,
  startDeliverableRevision, reviewDeliverable, addMilestoneFeedback, listProjectFeedback,
  createTaskFromFeedback, getFeedbackTaskLink, listTaskFeedback,
  type ReviewDeliverableInput, type MilestoneFeedbackInput, type FeedbackTaskInput,
} from "@/lib/deliverable";
import { getProjectDeliverableStats, listTeacherDeliverableStats, listMyRevisionRequiredDeliverables, listDeliverableEvidence,
  type TeacherStatsOptions, type MyRevisionOptions, type DeliverableEvidenceOptions,
} from "@/lib/deliverable-reporting";

export type DeliverableResult<T> = { ok: true; data: T } | {
  ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "INTERNAL"; error: string;
};

async function authenticated<T>(run: (actorId: string) => Promise<T>): Promise<DeliverableResult<T>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHENTICATED", error: "请先登录" };
  try { return { ok: true, data: await run(session.user.id) }; }
  catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, code: "FORBIDDEN", error: error.message };
    if (error instanceof DeliverableError) return { ok: false, code: error.code, error: error.message };
    // Do not send database errors, SQL or connection details to the browser.
    console.error("[deliverables] operation failed", error instanceof Error ? error.name : "UnknownError");
    return { ok: false, code: "INTERNAL", error: "成果服务暂时不可用，请刷新确认保存状态后重试" };
  }
}

function refresh(projectId: string) {
  // A cache failure after commit must not falsely report a failed write.
  try {
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/projects/${projectId}/deliverables`);
    revalidatePath(`/projects/${projectId}/deliverables`, "layout");
    revalidatePath(`/projects/${projectId}/overview`);
  } catch { console.error("[deliverables] cache refresh failed"); }
}

export async function listDeliverablesAction(projectId: string) {
  return authenticated((actorId) => listProjectDeliverables(actorId, projectId));
}

export async function getDeliverableAction(projectId: string, deliverableId: string) {
  return authenticated((actorId) => getDeliverableDetail(actorId, projectId, deliverableId));
}

export async function createDeliverableDraftAction(projectId: string, input: CreateDeliverableInput) {
  const result = await authenticated((actorId) => createDeliverableDraft(actorId, projectId, input));
  if (result.ok) refresh(result.data.projectId);
  return result;
}

export async function updateDeliverableDraftAction(projectId: string, deliverableId: string, input: UpdateDeliverableInput) {
  const result = await authenticated((actorId) => updateDeliverableDraft(actorId, projectId, deliverableId, input));
  if (result.ok) refresh(result.data.projectId);
  return result;
}

export async function submitDeliverableAction(projectId: string, deliverableId: string, input: SubmitDeliverableInput) {
  const result = await authenticated((actorId) => submitDeliverable(actorId, projectId, deliverableId, input));
  if (result.ok) refresh(result.data.deliverable.projectId);
  return result;
}

export async function startDeliverableRevisionAction(projectId: string, deliverableId: string, input: SubmitDeliverableInput) {
  const result = await authenticated((actorId) => startDeliverableRevision(actorId, projectId, deliverableId, input));
  if (result.ok) refresh(result.data.projectId);
  return result;
}

export async function reviewDeliverableAction(projectId: string, deliverableId: string, input: ReviewDeliverableInput) {
  const result = await authenticated((actorId) => reviewDeliverable(actorId, projectId, deliverableId, input));
  if (result.ok) refresh(result.data.deliverable.projectId);
  return result;
}

export async function addMilestoneFeedbackAction(projectId: string, milestoneId: string, input: MilestoneFeedbackInput) {
  const result = await authenticated((actorId) => addMilestoneFeedback(actorId, projectId, milestoneId, input));
  if (result.ok) refresh(result.data.feedback.projectId);
  return result;
}

export async function listProjectFeedbackAction(projectId: string) {
  return authenticated((actorId) => listProjectFeedback(actorId, projectId));
}

export async function createTaskFromFeedbackAction(projectId: string, feedbackId: string, input: FeedbackTaskInput) {
  const result = await authenticated((actorId) => createTaskFromFeedback(actorId, projectId, feedbackId, input));
  if (result.ok) refresh(projectId);
  return result;
}

export async function getFeedbackTaskLinkAction(projectId: string, feedbackId: string) {
  return authenticated((actorId) => getFeedbackTaskLink(actorId, projectId, feedbackId));
}

export async function listTaskFeedbackAction(projectId: string, taskId: string) {
  return authenticated((actorId) => listTaskFeedback(actorId, projectId, taskId));
}

export async function getProjectDeliverableStatsAction(projectId: string) {
  return authenticated((actorId) => getProjectDeliverableStats(actorId, projectId));
}

export async function listTeacherDeliverableStatsAction(input: TeacherStatsOptions = {}) {
  return authenticated((actorId) => listTeacherDeliverableStats(actorId, input));
}

export async function listMyRevisionRequiredDeliverablesAction(input: MyRevisionOptions = {}) {
  return authenticated((actorId) => listMyRevisionRequiredDeliverables(actorId, input));
}

export async function listDeliverableEvidenceAction(projectId: string, input: DeliverableEvidenceOptions = {}) {
  return authenticated((actorId) => listDeliverableEvidence(actorId, projectId, input));
}
