import { z } from "zod";
import { auth } from "@/lib/auth";
import type { ErrorCode, Result } from "@/contracts/p0-p2";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

// C / P0：Action 层的统一出入口。契约（§9.1）要求写操作一律返回判别式 Result<T>，
// 且失败要给得出 ErrorCode。这里把「取会话 -> 跑服务 -> 翻错误码」收敛成一处，
// 免得九个 action 各写一遍 try/catch 还漏掉某类错误。

/**
 * 把异常翻成契约的错误码。
 *
 * 注意顺序：三个新错误类都继承 AppError，所以必须先判子类。落到兜底的
 * 一律记日志、对浏览器只说「暂时不可用」——数据库/SQL/连接细节不得外泄。
 */
function describeError(error: unknown): { code: ErrorCode; error: string } {
  if (error instanceof z.ZodError) {
    return { code: "VALIDATION", error: error.issues[0]?.message ?? "输入不合法" };
  }
  if (error instanceof ForbiddenError) return { code: "FORBIDDEN", error: error.message };
  if (error instanceof NotFoundError) return { code: "FORBIDDEN", error: error.message };
  if (error instanceof ConflictError) return { code: "CONFLICT", error: error.message };
  if (error instanceof ValidationError) return { code: "VALIDATION", error: error.message };
  // 服务层用裸 AppError 表达领域规则（「负责人不是团队成员」之类），消息可直接展示
  if (error instanceof AppError) return { code: "VALIDATION", error: error.message };

  console.error("[C] action failed", error instanceof Error ? error.name : "UnknownError");
  return { code: "INTERNAL", error: "服务暂时不可用，请刷新确认保存状态后重试" };
}

/** 取会话并执行。未登录返回 UNAUTHENTICATED，绝不把 actorId 交给未鉴权的调用。 */
export async function runAction<T>(run: (actorId: string) => Promise<T>): Promise<Result<T>> {
  const session = await auth();
  const actorId = session?.user?.id;
  if (!actorId) return { ok: false, code: "UNAUTHENTICATED", error: "请先登录" };

  try {
    return { ok: true, data: await run(actorId) };
  } catch (error) {
    return { ok: false, ...describeError(error) };
  }
}
