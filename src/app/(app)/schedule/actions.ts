"use server";
import { runAction } from "@/lib/action-result";
import {
  previewScheduleImport,
  manualOccurrences,
  type PreviewImportInput,
  type ManualScheduleInput,
} from "@/lib/schedule/importer";
import {
  importMySchedule,
  saveMyPreferences,
  changeMyEvent,
} from "@/lib/schedule/store";
import type {
  ScheduleEventInput,
  GeneratePlanInput,
} from "@/lib/schedule/types";
import {
  generatePersonalPlan,
  changePersonalPlan,
} from "@/lib/schedule/planner";

export async function previewScheduleAction(input: PreviewImportInput) {
  return runAction(async () => previewScheduleImport(input));
}
export async function importScheduleAction(input: {
  requestId: string;
  events: ScheduleEventInput[];
  source: "ics" | "csv";
}) {
  return runAction((actorId) => importMySchedule(actorId, input));
}
export async function addManualScheduleAction(
  input: ManualScheduleInput & { requestId: string },
) {
  return runAction((actorId) => {
    const { requestId, ...manual } = input;
    return importMySchedule(actorId, {
      requestId,
      events: manualOccurrences(manual),
      source: "manual",
    });
  });
}
export async function saveSchedulePreferencesAction(
  input: Parameters<typeof saveMyPreferences>[1],
) {
  return runAction((actorId) => saveMyPreferences(actorId, input));
}
export async function changeScheduleEventAction(
  id: string,
  input: Parameters<typeof changeMyEvent>[2],
) {
  return runAction((actorId) => changeMyEvent(actorId, id, input));
}
export async function generatePersonalPlanAction(
  projectId: string,
  input: GeneratePlanInput,
) {
  return runAction((actorId) =>
    generatePersonalPlan(actorId, projectId, input),
  );
}
export async function changePersonalPlanAction(
  projectId: string,
  id: string,
  input: Parameters<typeof changePersonalPlan>[3],
) {
  return runAction((actorId) =>
    changePersonalPlan(actorId, projectId, id, input),
  );
}
