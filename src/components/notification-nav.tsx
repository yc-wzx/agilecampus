import Link from "next/link";
import { getUnreadNotificationCount } from "@/lib/notifications";
export async function NotificationNav({ actorId }: { actorId: string }) {
  let count: number | null = null;
  try { count = (await getUnreadNotificationCount(actorId)).count; }
  catch { console.error("[notifications] unread count unavailable"); }
  return <Link href="/notifications" aria-label={count === null ? "通知，未读数暂时不可用" : `通知，${count} 条未读`}
    className="whitespace-nowrap rounded-field px-2.5 py-1.5 text-sm text-ink-soft hover:bg-primary-soft hover:text-primary">
    通知 {count === null ? "…" : count > 0 ? <span className="ac-badge">{count > 99 ? "99+" : count}</span> : null}
  </Link>;
}
