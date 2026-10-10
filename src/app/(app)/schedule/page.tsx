import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMySchedule } from "@/lib/schedule/store";
import { addDays, shanghaiDay } from "@/lib/schedule/types";
import {
  ImportForm,
  ManualForm,
  PreferencesForm,
  EventControls,
} from "@/components/schedule/forms";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sp = await searchParams,
    startDate = sp.from ?? shanghaiDay(),
    endDate = sp.to ?? addDays(startDate, 30),
    offset = Math.max(0, Number(sp.offset) || 0);
  const data = await getMySchedule(session.user.id, {
    startDate,
    endDate,
    offset,
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
        <h1 className="font-display text-2xl">我的课表与日程</h1>
        <p className="text-sm text-ink-soft">
          仅本人可见。导入课程、考试及其他忙碌时间，在项目 AI
          助手中生成个人短期工作计划。
        </p>
        <Link href="/projects" className="text-sm text-primary underline">
          选择项目进行规划
        </Link>
      </header>
      <section className="ac-card space-y-3 p-4">
        <h2 className="font-semibold">可投入时间</h2>
        <p className="text-xs text-ink-soft">
          未上课不等于可以工作。只在你设置的时段内规划，每天最多 4
          小时；请把休息、考试和其他占用时间登记完整。
        </p>
        <PreferencesForm
          preferences={data.preferences}
          revision={data.revision}
          requestId={randomUUID()}
        />
      </section>
      <section className="ac-card space-y-3 p-4">
        <h2 className="font-semibold">导入课表／日历</h2>
        <ImportForm
          startDate={shanghaiDay()}
          endDate={addDays(shanghaiDay(), 90)}
          requestId={randomUUID()}
        />
      </section>
      <details className="ac-card p-4">
        <summary className="cursor-pointer font-semibold">
          手动补充日程／每周课程
        </summary>
        <div className="mt-3">
          <ManualForm requestId={randomUUID()} />
        </div>
      </details>
      <section className="space-y-3">
        <h2 className="font-semibold">已登记日程</h2>
        <form className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 text-sm">
            开始日期
            <input
              type="date"
              name="from"
              defaultValue={startDate}
              required
              className="ac-field"
            />
          </label>
          <label className="min-w-0 text-sm">
            结束日期
            <input
              type="date"
              name="to"
              defaultValue={endDate}
              required
              className="ac-field"
            />
          </label>
          <button className="ac-btn">查看日程</button>
        </form>
        {!data.items.length && (
          <p className="text-sm text-ink-soft">
            当前范围尚无已登记日程，请导入或手动补充。
          </p>
        )}
        {data.items.map((event) => (
          <article key={event.id} className="ac-card space-y-2 p-4">
            <h3 className="break-words font-medium">{event.title}</h3>
            <p className="text-sm text-ink-soft">
              {time(event.startAt)}—{time(event.endAt)}（北京时间）
            </p>
            <EventControls event={event} requestId={randomUUID()} />
          </article>
        ))}
        <nav className="flex gap-4 text-sm">
          {offset > 0 && (
            <Link
              href={`?from=${startDate}&to=${endDate}&offset=${Math.max(0, offset - 50)}`}
            >
              上一页
            </Link>
          )}
          {data.nextOffset !== null && (
            <Link
              href={`?from=${startDate}&to=${endDate}&offset=${data.nextOffset}`}
            >
              下一页
            </Link>
          )}
        </nav>
      </section>
    </main>
  );
}
