import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDeliverableDetail } from "@/lib/deliverable";
import {
  getDeliverableComparison,
  type compareText,
} from "@/lib/deliverable-comparison";
import { AppError } from "@/lib/errors";
import type { DeliverableType } from "@/db/schema";
import { ProjectNav } from "@/components/projects/project-nav";

const typeNames: Record<DeliverableType, string> = {
  report: "报告",
  presentation: "演示文稿",
  video: "视频",
  survey: "调研",
  code: "代码",
  prototype: "原型",
  demo: "演示",
  other: "其他",
};

function TextDiff({ value }: { value: ReturnType<typeof compareText> }) {
  return (
    <div className="space-y-2">
      {value.simplified && (
        <p className="text-xs text-ink-soft">文字变化较大，以下按整段展示。</p>
      )}
      <div className="whitespace-pre-wrap break-words rounded-lg bg-sunken p-3 text-sm">
        {value.changes.length
          ? value.changes.map((change, index) =>
              change.added ? (
                <ins
                  key={index}
                  className="bg-green-100 text-green-900 no-underline"
                >
                  <span className="text-xs">[新增]</span>
                  {change.value}
                </ins>
              ) : change.removed ? (
                <del key={index} className="bg-red-100 text-red-900">
                  <span className="text-xs">[删除]</span>
                  {change.value}
                </del>
              ) : (
                <span key={index}>{change.value}</span>
              ),
            )
          : "（空内容）"}
      </div>
    </div>
  );
}

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; deliverableId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId, deliverableId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (![projectId, deliverableId].every((id) => z.uuid().safeParse(id).success))
    notFound();
  let detail;
  try {
    detail = await getDeliverableDetail(
      session.user.id,
      projectId,
      deliverableId,
    );
  } catch (error) {
    if (error instanceof AppError) notFound();
    throw error;
  }
  const search = await searchParams;
  const versions = detail.versions;
  const fromId =
    typeof search.from === "string"
      ? search.from
      : (versions[1] ?? versions[0])?.id;
  const toId = typeof search.to === "string" ? search.to : versions[0]?.id;
  let comparison = null;
  if (fromId && toId) {
    try {
      comparison = await getDeliverableComparison(
        session.user.id,
        projectId,
        deliverableId,
        fromId,
        toId,
      );
    } catch (error) {
      if (error instanceof AppError) notFound();
      throw error;
    }
  }
  const path =
    "/projects/" + projectId + "/deliverables/" + deliverableId + "/compare";
  const formatDate = (date: Date) =>
    date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  return (
    <main className="mx-auto max-w-4xl space-y-5 py-8">
      <ProjectNav projectId={projectId} current="deliverables" />
      <Link
        href={"/projects/" + projectId + "/deliverables"}
        className="text-sm text-primary hover:underline"
      >
        ← 返回成果列表
      </Link>
      <h1 className="break-words font-display text-2xl font-semibold">
        成果版本对比
      </h1>
      <p className="text-sm text-ink-soft">
        仅比较本站保存的标题、说明、链接和关联阶段；外部文档正文变化不在本次比较范围内。
      </p>
      {versions.length < 2 && (
        <p className="ac-card p-4 text-sm text-ink-soft">
          {versions.length
            ? "目前只有一个已提交版本，提交第二版后可查看变化。"
            : "暂无已提交版本。"}
        </p>
      )}
      {versions.length > 0 && (
        <form
          action={path}
          method="get"
          className="ac-card flex flex-wrap items-end gap-3 p-4"
        >
          <label className="min-w-40 flex-1 text-sm text-ink-soft">
            原版本
            <select name="from" defaultValue={fromId} className="ac-field">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  第 {v.versionNumber} 版 · {formatDate(v.submittedAt)}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-40 flex-1 text-sm text-ink-soft">
            比较版本
            <select name="to" defaultValue={toId} className="ac-field">
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  第 {v.versionNumber} 版 · {formatDate(v.submittedAt)}
                </option>
              ))}
            </select>
          </label>
          <button className="ac-btn">比较</button>
        </form>
      )}
      {comparison && (
        <section className="ac-card space-y-5 p-4 sm:p-6">
          <h2 className="font-medium">
            第 {comparison.from.number} 版 → 第 {comparison.to.number} 版
          </h2>
          {!comparison.changed && (
            <p role="status" className="text-sm text-ink-soft">
              所比较的内容没有变化。
            </p>
          )}
          <div className="space-y-2">
            <h3 className="font-medium">标题变化</h3>
            <TextDiff value={comparison.title} />
          </div>
          <div className="space-y-2">
            <h3 className="font-medium">成果说明变化</h3>
            <TextDiff value={comparison.description} />
          </div>
          <div className="space-y-2">
            <h3 className="font-medium">
              成果链接{comparison.links.changed ? "（已修改）" : "（未修改）"}
            </h3>
            <p className="break-all text-sm">
              原版本：
              <a
                href={comparison.links.before}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {comparison.links.before}
              </a>
            </p>
            <p className="break-all text-sm">
              比较版本：
              <a
                href={comparison.links.after}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {comparison.links.after}
              </a>
            </p>
          </div>
          <p className="text-sm text-ink-soft">
            关联阶段：{comparison.metadata.milestone.before ?? "未关联"} →{" "}
            {comparison.metadata.milestone.after ?? "未关联"}
          </p>
          <p className="text-sm text-ink-soft">
            成果类型：{typeNames[comparison.metadata.type.before]} →{" "}
            {typeNames[comparison.metadata.type.after]}
          </p>
        </section>
      )}
      <details className="ac-card p-4">
        <summary className="cursor-pointer text-sm">
          已提交版本记录（{versions.length}）
        </summary>
        <ol className="mt-3 space-y-2">
          {versions.map((v) => (
            <li key={v.id} className="text-sm">
              第 {v.versionNumber} 版 · {formatDate(v.submittedAt)} · {v.title}
            </li>
          ))}
        </ol>
      </details>
    </main>
  );
}
