import { auth } from "@/lib/auth";
import { exportProjectCalendar } from "@/lib/project-calendar";
import { ForbiddenError } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return Response.json(
      { error: "请先登录" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  const { projectId } = await context.params;
  try {
    const origin =
      process.env.AGILECAMPUS_URL ||
      process.env.AUTH_URL ||
      new URL(request.url).origin;
    const result = await exportProjectCalendar(
      session.user.id,
      projectId,
      origin,
    );
    return new Response(result.content, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="agilecampus-deadlines.ics"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Calendar-Events": String(result.count),
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError)
      return Response.json(
        { error: "项目不存在或无权访问" },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    console.error(
      "[calendar] export failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { error: "日历导出失败，请稍后重试" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
