import Link from "next/link";
import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getProjectForUser } from "@/lib/project";
import { getWeeklyReport, REPORT_SECTION_LABELS } from "@/lib/report";
import { todayInShanghai, addDays } from "@/lib/dashboard";
import { ProjectNav } from "@/components/projects/project-nav";
import { MarkdownDownload } from "@/components/markdown-download";
import { exportWeeklyReportMarkdownAction } from "./actions";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ weekStart?: string }>;
}) {
  const { projectId } = await params,
    query = await searchParams;
  if (!z.uuid().safeParse(projectId).success) notFound();
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const today = todayInShanghai(),
    day = new Date(today + "T12:00:00+08:00").getUTCDay(),
    defaultWeek = addDays(today, -((day + 6) % 7));
  const weekStart = query.weekStart ?? defaultWeek;
  const invalid =
    !z.iso.date().safeParse(weekStart).success ||
    new Date(weekStart + "T12:00:00+08:00").getUTCDay() !== 1;
  const report = invalid
    ? null
    : await getWeeklyReport(session.user.id, projectId, { weekStart });
  return (
    <main className="mx-auto max-w-4xl space-y-5 py-8 [overflow-wrap:anywhere]">
      <ProjectNav projectId={projectId} current="reports" />
      <h1 className="font-display text-2xl font-semibold">
        {access.project.name} · 规则周报
      </h1>
      <form className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          周一起点
          <input
            name="weekStart"
            type="date"
            className="ac-field block"
            defaultValue={weekStart}
            required
          />
        </label>
        <button className="ac-btn">查看周报</button>
      </form>
      {invalid && (
        <p role="alert" className="text-high">
          请选择周一作为起点
        </p>
      )}
      {report && (
        <>
          <p className="text-sm text-ink-soft">
            {report.weekStart} 至 {report.weekEnd}（不含结束日） · 生成时间{" "}
            {new Date(report.asOf).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
          </p>
          <p className="text-xs text-ink-soft">{report.coverage.note}</p>
          <MarkdownDownload
            action={exportWeeklyReportMarkdownAction.bind(null, projectId, {
              weekStart,
            })}
          />
          {Object.entries(report.sections).map(([key, items]) => (
            <section key={key} className="ac-card space-y-3 p-5">
              <h2 className="font-semibold">
                {REPORT_SECTION_LABELS[key as keyof typeof report.sections]}
              </h2>
              {items.length === 0 ? (
                <p className="text-sm text-ink-soft">暂无记录</p>
              ) : (
                items.map((item) => (
                  <article
                    key={item.factKey}
                    className="border-t border-line pt-3"
                  >
                    <h3 className="text-sm font-medium">{item.title}</h3>
                    <p className="text-sm text-ink-soft">{item.summary}</p>
                    {item.sourceRefs.map(
                      (source) =>
                        source.sourceHref && (
                          <Link
                            key={source.evidenceKey}
                            href={source.sourceHref}
                            className="text-xs text-primary underline"
                          >
                            查看来源
                          </Link>
                        ),
                    )}
                  </article>
                ))
              )}
            </section>
          ))}
        </>
      )}
    </main>
  );
}
