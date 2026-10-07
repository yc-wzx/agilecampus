import { auth } from "@/lib/auth";
import { DeliverableError } from "@/lib/deliverable";
import { getDeliverableEvidenceRecord, type EvidenceSourceKind } from "@/lib/deliverable-reporting";
import { ForbiddenError } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie" } });
}

// Read-only, session-authenticated source for exported evidence. No public sharing token.
export async function GET(_request: Request, context: {
  params: Promise<{ projectId: string; kind: string; recordId: string }>;
}) {
  try {
    const session = await auth();
    if (!session?.user?.id) return json({ error: "请先登录", code: "UNAUTHENTICATED" }, 401);
    const { projectId, kind, recordId } = await context.params;
    // Service validates kind at runtime as well as IDs and current membership.
    const record = await getDeliverableEvidenceRecord(session.user.id, projectId, kind as EvidenceSourceKind, recordId);
    return json({ data: record });
  } catch (error) {
    if (error instanceof ForbiddenError) return json({ error: error.message, code: "FORBIDDEN" }, 403);
    if (error instanceof DeliverableError) return json({ error: error.message, code: error.code }, 400);
    console.error("[deliverable-evidence] read failed", error instanceof Error ? error.name : "UnknownError");
    return json({ error: "证据暂时不可用，请稍后重试", code: "INTERNAL" }, 500);
  }
}
