import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { ForbiddenError } from "@/lib/errors";
import { getProjectLeadership } from "@/lib/project-extras";
import { LeaderForm } from "@/app/(app)/projects/[projectId]/extras/leader-form";

export async function ProjectLeadership({
  actorId,
  projectId,
  canManage,
  members,
}: {
  actorId: string;
  projectId: string;
  canManage: boolean;
  members: { id: string; name: string }[];
}) {
  let leadership;
  try {
    leadership = await getProjectLeadership(actorId, projectId);
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    console.error(
      "[leadership] query unavailable",
      error instanceof Error ? error.name : "UnknownError",
    );
    return (
      <p className="ac-card p-4 text-sm text-high">
        项目负责人暂时不可用，请稍后重试。
      </p>
    );
  }
  return (
    <section className="ac-card space-y-3 p-4" aria-label="项目负责人">
      <h2 className="break-words font-medium">
        项目负责人：{leadership.name ?? "未指定"}
        {leadership.name && !leadership.active ? "（已离队）" : ""}
      </h2>
      {canManage && (
        <LeaderForm
          key={leadership.revision}
          projectId={projectId}
          requestId={randomUUID()}
          leaderId={leadership.leaderId}
          revision={leadership.revision}
          members={members}
        />
      )}
      {leadership.changes.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-ink-soft">
            最近20条负责人变更
          </summary>
          <ol className="mt-2 space-y-1 text-sm text-ink-soft">
            {leadership.changes.map((change) => (
              <li key={change.id} className="[overflow-wrap:anywhere]">
                {change.createdAt.toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}{" "}
                · {change.actorName}：{change.previousLeaderName ?? "未指定"} →{" "}
                {change.leaderName ?? "未指定"}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
