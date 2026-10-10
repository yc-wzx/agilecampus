import Link from "next/link";
import { auth } from "@/lib/auth";
import { getPinnedAnnouncement } from "@/lib/announcement";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
export async function ProjectAnnouncement({
  projectId,
}: {
  projectId: string;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  let item;
  try {
    item = await getPinnedAnnouncement(session.user.id, projectId);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError)
      throw error;
    return (
      <section className="ac-card p-5">
        <h2>项目公告</h2>
        <p className="text-sm text-ink-soft">公告暂时不可用，请刷新重试。</p>
      </section>
    );
  }
  return (
    <section className="ac-card space-y-3 p-5 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">项目公告</h2>
        <Link
          href={`/projects/${projectId}/announcements`}
          className="text-sm text-primary underline"
        >
          查看全部公告
        </Link>
      </div>
      {item ? (
        <>
          <h3 className="font-medium">{item.title}</h3>
          <p className="whitespace-pre-wrap text-sm">{item.body}</p>
        </>
      ) : (
        <p className="text-sm text-ink-soft">暂无置顶公告</p>
      )}
    </section>
  );
}
