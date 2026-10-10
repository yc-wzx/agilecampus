"use server";
import * as actions from "../tasks/comments/actions";
export async function createTaskCommentAction(
  ...args: Parameters<typeof actions.createTaskCommentAction>
) {
  return actions.createTaskCommentAction(...args);
}
export async function updateTaskCommentAction(
  ...args: Parameters<typeof actions.updateTaskCommentAction>
) {
  return actions.updateTaskCommentAction(...args);
}
export async function deleteTaskCommentAction(
  ...args: Parameters<typeof actions.deleteTaskCommentAction>
) {
  return actions.deleteTaskCommentAction(...args);
}
