import { z } from "zod";
import { auth } from "@/lib/auth";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { getTeamAvailability } from "@/lib/schedule/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(
  request: Request,
  context: { params: Promise<{ teamId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return Response.json({ error: "请先登录" }, { status: 401, headers });
  try {
    const { teamId } = await context.params,
      query = new URL(request.url).searchParams;
    const input = z
      .strictObject({
        startDate: z.iso.date().optional(),
        days: z.coerce
          .number()
          .pipe(z.union([z.literal(7), z.literal(14)]))
          .optional(),
      })
      .parse({
        startDate: query.get("from") ?? undefined,
        days: query.get("days") ?? undefined,
      });
    const result = await getTeamAvailability(session.user.id, teamId, input);
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof ForbiddenError)
      return Response.json({ error: error.message }, { status: 403, headers });
    if (error instanceof z.ZodError || error instanceof ValidationError)
      return Response.json(
        { error: "日程查看范围无效或数据过多" },
        { status: 400, headers },
      );
    console.error(
      "[availability] read failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return Response.json(
      { error: "日程读取失败，请稍后重试" },
      { status: 500, headers },
    );
  }
}
