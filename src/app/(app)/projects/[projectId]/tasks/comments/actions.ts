"use server";
import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/action-result";
import {
  createTaskComment,
  deleteTaskComment,
  listTaskComments,
  updateTaskComment,
  getCommentPageOffset,
} from "@/lib/comments";
import { getProjectForUser } from "@/lib/project";
import { listTeamMembers } from "@/lib/team";
import { ForbiddenError } from "@/lib/errors";
import type { PageInput } from "@/contracts/p0-p2";
async function mutate<T>(run: (actor: string) => Promise<T>) {
  const result = await runAction(run);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}
export async function getTaskCommentsAction(
  projectId: string,
  taskId: string,
  paging: PageInput = {},
  focusCommentId?: string,
) {
  return runAction(async (actor) => {
    const access = await getProjectForUser(actor, projectId);
    if (!access) throw new ForbiddenError();
    const targetOffset = focusCommentId
      ? await getCommentPageOffset(
          actor,
          projectId,
          taskId,
          focusCommentId,
          paging.limit ?? 20,
        )
      : undefined;
    return {
      page: await listTaskComments(
        actor,
        projectId,
        taskId,
        targetOffset === undefined || targetOffset === null
          ? paging
          : { ...paging, offset: targetOffset },
      ),
      focusUnavailable: targetOffset === null,
      actorId: actor,
      role: access.role,
      members: (await listTeamMembers(access.project.teamId)).map((m) => ({
        id: m.id,
        name: m.name,
      })),
    };
  });
}
export async function createTaskCommentAction(
  projectId: string,
  taskId: string,
  input: Parameters<typeof createTaskComment>[3],
) {
  return mutate((actor) => createTaskComment(actor, projectId, taskId, input));
}
export async function updateTaskCommentAction(
  projectId: string,
  taskId: string,
  commentId: string,
  input: Parameters<typeof updateTaskComment>[4],
) {
  return mutate((actor) =>
    updateTaskComment(actor, projectId, taskId, commentId, input),
  );
}
export async function deleteTaskCommentAction(
  projectId: string,
  taskId: string,
  commentId: string,
  input: Parameters<typeof deleteTaskComment>[4],
) {
  return mutate((actor) =>
    deleteTaskComment(actor, projectId, taskId, commentId, input),
  );
}
