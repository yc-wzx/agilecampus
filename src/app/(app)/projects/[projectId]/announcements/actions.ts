"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import {
  publishAnnouncement,
  republishAnnouncement,
  setAnnouncementPinned,
  updateAnnouncement,
  withdrawAnnouncement,
} from "@/lib/announcement";
async function mutate<T>(run: (actor: string) => Promise<T>) {
  const result = await runAction(run);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
export async function publishAnnouncementAction(
  projectId: string,
  input: Parameters<typeof publishAnnouncement>[2],
) {
  return mutate((actor) => publishAnnouncement(actor, projectId, input));
}
export async function updateAnnouncementAction(
  projectId: string,
  id: string,
  input: Parameters<typeof updateAnnouncement>[3],
) {
  return mutate((actor) => updateAnnouncement(actor, projectId, id, input));
}
export async function setAnnouncementPinnedAction(
  projectId: string,
  id: string,
  input: Parameters<typeof setAnnouncementPinned>[3],
) {
  return mutate((actor) => setAnnouncementPinned(actor, projectId, id, input));
}
export async function withdrawAnnouncementAction(
  projectId: string,
  id: string,
  input: Parameters<typeof withdrawAnnouncement>[3],
) {
  return mutate((actor) => withdrawAnnouncement(actor, projectId, id, input));
}
export async function republishAnnouncementAction(
  projectId: string,
  id: string,
  input: Parameters<typeof republishAnnouncement>[3],
) {
  return mutate((actor) => republishAnnouncement(actor, projectId, id, input));
}
