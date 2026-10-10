"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { runAction } from "@/lib/action-result";
import type { ErrorCode, Result } from "@/contracts/p0-p2";
import {
  createProjectReference,
  updateProjectReference,
  deleteProjectReference,
  setProjectLeader,
  type ReferenceInput,
  type UpdateReferenceInput,
  type LeadInput,
} from "@/lib/project-extras";

// Object Actions follow the shared Result/error-code contract. FormData adapters remain below.
export async function createProjectReferenceAction(
  projectId: string,
  input: ReferenceInput,
) {
  return runAction((actorId) =>
    createProjectReference(actorId, projectId, input),
  );
}
export async function updateProjectReferenceAction(
  projectId: string,
  id: string,
  input: UpdateReferenceInput & { requestId: string },
) {
  return runAction((actorId) => {
    z.uuid().parse(input.requestId);
    return updateProjectReference(actorId, projectId, id, input);
  });
}
export async function deleteProjectReferenceAction(
  projectId: string,
  id: string,
  input: { expectedRevision: number; requestId: string },
) {
  return runAction(async (actorId) => {
    z.uuid().parse(input.requestId);
    await deleteProjectReference(
      actorId,
      projectId,
      id,
      input.expectedRevision,
      input.requestId,
    );
    return { id, deleted: true as const };
  });
}
export async function setProjectLeaderAction(
  projectId: string,
  input: LeadInput & { requestId: string },
) {
  return runAction((actorId) => {
    z.uuid().parse(input.requestId);
    return setProjectLeader(actorId, projectId, input);
  });
}

export type ExtraState = {
  ok: boolean;
  message: string;
  code?: ErrorCode;
  nextRequestId?: string;
} | null;
function formState<T>(result: Result<T>, message = "已保存"): ExtraState {
  return result.ok
    ? { ok: true, message, nextRequestId: randomUUID() }
    : { ok: false, message: result.error, code: result.code };
}
function referenceInput(form: FormData) {
  const nullable = (key: string) => String(form.get(key) || "").trim() || null;
  return {
    title: String(form.get("title") || ""),
    type: String(form.get("type") || "other") as
      "meeting" | "document" | "video" | "prototype" | "other",
    url: String(form.get("url") || ""),
    minutesUrl: nullable("minutesUrl"),
    recordingUrl: nullable("recordingUrl"),
    meetingDate: nullable("meetingDate"),
    participantIds: form.getAll("participantIds").map(String),
    milestoneId: nullable("milestoneId"),
    note: String(form.get("note") || ""),
    requestId: String(form.get("requestId") || ""),
  };
}
export async function saveReferenceAction(
  projectId: string,
  referenceId: string | null,
  _previous: ExtraState,
  form: FormData,
): Promise<ExtraState> {
  const result = referenceId
    ? await updateProjectReferenceAction(projectId, referenceId, {
        ...referenceInput(form),
        expectedRevision: Number(form.get("expectedRevision")),
      })
    : await createProjectReferenceAction(projectId, referenceInput(form));
  return formState(result);
}
export async function deleteReferenceAction(
  projectId: string,
  referenceId: string,
  _previous: ExtraState,
  form: FormData,
): Promise<ExtraState> {
  return formState(
    await deleteProjectReferenceAction(projectId, referenceId, {
      expectedRevision: Number(form.get("expectedRevision")),
      requestId: String(form.get("requestId") || ""),
    }),
    "已删除",
  );
}
export async function setLeaderAction(
  projectId: string,
  _previous: ExtraState,
  form: FormData,
): Promise<ExtraState> {
  return formState(
    await setProjectLeaderAction(projectId, {
      leaderId: String(form.get("leaderId") || "") || null,
      expectedRevision: Number(form.get("expectedRevision")),
      requestId: String(form.get("requestId") || ""),
    }),
  );
}
