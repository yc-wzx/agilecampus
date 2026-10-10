import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";
import { getTeamAvailability } from "@/lib/schedule/availability";
import { shanghaiDay } from "@/lib/schedule/types";

export const dynamic = "force-dynamic";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { teamId } = await params,
    sp = await searchParams;
  if (!z.uuid().safeParse(teamId).success) notFound();
  const startDate = z.iso.date().safeParse(sp.from).success
    ? sp.from!
    : shanghaiDay();
  const days = sp.days === "14" ? 14 : 7;
  const data = await getTeamAvailability(session.user.id, teamId, {
    startDate,
    days,
  }).catch((error) => {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  });
  const time = (iso: string) =>
    new Date(iso).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return (
    <main className="mx-auto max-w-4xl space-y-5 py-8">
      <header className="space-y-2">
        <h1 className="break-words font-display text-2xl">
          {data.team.name} · 团队忙碌日程
        </h1>
        <p className="text-sm text-ink-soft">
          只显示成员自愿公开的忙碌时间，按半小时向外取整并合并。老师和组员看到相同信息，不显示事件名称、备注或具体事情。
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link href="/teams" className="text-primary underline">
            返回团队
          </Link>
          <Link href="/schedule" className="text-primary underline">
            管理我的日程与共享设置
          </Link>
        </div>
      </header>
      <form className="flex flex-wrap items-end gap-3">
        <label className="min-w-0 text-sm">
          开始日期
          <input
            type="date"
            name="from"
            required
            defaultValue={startDate}
            className="ac-field"
          />
        </label>
        <label className="text-sm">
          范围
          <select name="days" defaultValue={days} className="ac-field">
            <option value={7}>7 天</option>
            <option value={14}>14 天</option>
          </select>
        </label>
        <button className="ac-btn">查看忙碌时间</button>
      </form>
      <p className="text-sm text-ink-soft">
        {data.startDate}—{data.endDate}
        （北京时间）。没有公开记录不代表有空，请联系成员确认。
      </p>
      {data.members.map((member) => (
        <section key={member.id} className="ac-card space-y-3 p-4">
          <h2 className="break-words font-semibold">
            {member.name} ·{" "}
            {member.role === "teacher"
              ? "导师"
              : member.role === "admin"
                ? "管理员"
                : "成员"}
          </h2>
          {!member.sharingEnabled ? (
            <p className="text-sm text-ink-soft">
              未共享日程，不能判断是否有空。
            </p>
          ) : !member.periods.length ? (
            <p className="text-sm text-ink-soft">
              当前没有公开忙碌时间，可能有未公开日程。
            </p>
          ) : (
            <ul className="space-y-2">
              {member.periods.map((p) => (
                <li
                  key={p.startAt}
                  className="rounded-lg border border-line p-3 text-sm"
                >
                  {time(p.startAt)}—{time(p.endAt)} · 忙碌
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </main>
  );
}
