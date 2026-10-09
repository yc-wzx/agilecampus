import { NextResponse } from "next/server";
import { auth } from "./auth";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";
import type { Result } from "@/contracts/p0-p2";
import type { NotificationFilters } from "@/contracts/p0-p2";

export function notificationFilters(params: URLSearchParams): NotificationFilters {
  const filters: Record<string, unknown> = Object.fromEntries(params);
  for (const key of ["limit", "offset"]) if (params.has(key)) filters[key] = Number(params.get(key));
  if (params.has("unreadOnly")) filters.unreadOnly = params.get("unreadOnly") === "true" ? true : params.get("unreadOnly") === "false" ? false : params.get("unreadOnly");
  return filters as NotificationFilters;
}
export async function notificationBody(request: Request) {
  try { return await request.json(); }
  catch { throw new ValidationError("请求内容必须是 JSON"); }
}

export async function notificationResult<T>(run: (actorId: string) => Promise<T>): Promise<Result<T>> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: "UNAUTHENTICATED", error: "请先登录" };
  try { return { ok: true, data: await run(session.user.id) }; }
  catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return { ok: false, code: "FORBIDDEN", error: error.message };
    if (error instanceof ValidationError) return { ok: false, code: "VALIDATION", error: error.message };
    if (error instanceof ConflictError) return { ok: false, code: "CONFLICT", error: error.message };
    console.error("[notifications] operation failed", error instanceof Error ? error.name : "UnknownError");
    return { ok: false, code: "INTERNAL", error: "通知服务暂时不可用，请稍后重试" };
  }
}
export async function notificationHttp<T>(run: (actorId: string) => Promise<T>, request?: Request) {
  if (request && request.method !== "GET") {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return NextResponse.json({ ok: false, code: "FORBIDDEN", error: "请求来源不正确" }, { status: 403 });
    }
  }
  const result = await notificationResult(run);
  if (result.ok) return NextResponse.json(result.data);
  const status = { UNAUTHENTICATED: 401, FORBIDDEN: 404, VALIDATION: 400, CONFLICT: 409, INTERNAL: 500 }[result.code];
  return NextResponse.json(result, { status });
}
