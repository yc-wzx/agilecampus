import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { getProjectForUser } from "@/lib/project";
import { ForbiddenError, AppError } from "@/lib/errors";
import { getOrCreateScopedConversation } from "./context";

// 每项目复用最近一条会话（MVP 简化：每项目一活跃会话）
export async function getOrCreateConversation(
  actorId: string,
  projectId: string,
) {
  return getOrCreateScopedConversation(actorId, projectId, {
    scope: "project",
  });
}

export type ToolTraceEntry = {
  toolName: string;
  input: unknown;
  output: unknown;
};

export async function persistTurn(
  conversationId: string,
  userText: string,
  assistantText: string,
  toolTrace: ToolTraceEntry[],
) {
  await db.insert(messages).values([
    { conversationId, role: "user", content: userText },
    {
      conversationId,
      role: "assistant",
      content: assistantText,
      toolCalls: toolTrace.length > 0 ? toolTrace : null,
    },
  ]);
}

export async function listConversationMessages(
  actorId: string,
  conversationId: string,
) {
  const [conv] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conv) throw new AppError("会话不存在");
  if (conv.scope === "personal" && conv.createdById !== actorId)
    throw new ForbiddenError();
  const access = await getProjectForUser(actorId, conv.projectId);
  if (!access) throw new ForbiddenError();

  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.seq))
    .limit(40);
}
