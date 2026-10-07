"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CurrentIteration, Iteration, Result, TaskSummary } from "@/contracts/p0-p2";
import {
  createIterationAction,
  deletePlannedIterationAction,
  startIterationAction,
} from "./actions";
// C-T03 归任务侧（定稿 9.2 的固定 Action 路径），不在迭代入口里
import { reorderBacklogAction } from "../tasks/actions";
import { newRequestId } from "@/lib/request-id";

// C / P0：迭代总览。建轮、开始、删除、任务池排序在这里；
// 单轮的任务增删、结束与复盘在 [iterationId] 页——那边的上下文才是「这一轮」。

const STATUS_LABEL: Record<Iteration["status"], string> = {
  planned: "计划中",
  active: "进行中",
  completed: "已结束",
};

export function IterationsView({
  projectId,
  canWrite,
  iterations,
  current,
  currentTasks,
  backlog,
}: {
  projectId: string;
  canWrite: boolean;
  iterations: Iteration[];
  current: CurrentIteration | null;
  currentTasks: TaskSummary[];
  backlog: TaskSummary[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** 正在提交的动作名，用来只禁用那一颗按钮，别把整页锁死。 */
  const [busy, setBusy] = useState<string | null>(null);
  /** 建轮成功后换一次 key，把表单清空——刷新只重取数据，不会清 input。 */
  const [formKey, setFormKey] = useState(0);

  const reload = () => startTransition(() => router.refresh());

  async function submit<T>(label: string, fn: () => Promise<Result<T>>): Promise<boolean> {
    setBusy(label);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      // 冲突多半是别人先动了这一轮：把最新状态取回来，用户才知道自己在跟什么较劲
      if (res.code === "CONFLICT") reload();
      return false;
    }
    reload();
    return true;
  }

  async function handleCreate(form: FormData) {
    const created = await submit("create", () =>
      createIterationAction(projectId, {
        requestId: newRequestId(),
        name: String(form.get("name") ?? "").trim(),
        goal: String(form.get("goal") ?? "").trim() || null,
        startDate: String(form.get("startDate") ?? ""),
        endDate: String(form.get("endDate") ?? ""),
      }),
    );
    if (created) setFormKey((n) => n + 1);
  }

  async function handleStart(iteration: Iteration) {
    await submit(`start:${iteration.id}`, () =>
      startIterationAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: iteration.revision,
      }),
    );
  }

  async function handleDelete(iteration: Iteration) {
    await submit(`delete:${iteration.id}`, () =>
      deletePlannedIterationAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: iteration.revision,
      }),
    );
  }

  /**
   * 任务池上移 / 下移。契约里的锚点是「插到谁前面」，所以下移要越过下一个任务，
   * 用它的下一个当锚点；已经在末尾时锚点为 null（插到末尾）。
   */
  async function handleMove(index: number, delta: -1 | 1) {
    const task = backlog[index];
    const beforeTaskId =
      delta === -1 ? (backlog[index - 1]?.id ?? null) : (backlog[index + 2]?.id ?? null);
    await submit(`move:${task.id}`, () =>
      reorderBacklogAction(projectId, {
        requestId: newRequestId(),
        taskId: task.id,
        beforeTaskId,
        expectedUpdatedAt: task.updatedAt,
      }),
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <p className="ac-card border-high/40 text-sm text-high" role="alert">
          {error}
        </p>
      )}

      {current ? (
        <section className="ac-card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium text-ink">当前迭代 · {current.name}</h2>
            <a
              href={`/projects/${projectId}/iterations/${current.id}`}
              className="text-xs text-primary underline"
            >
              查看与结束这一轮 →
            </a>
          </div>
          {current.goal && <p className="text-sm text-ink-soft">{current.goal}</p>}
          <p className="text-xs text-ink-faint">
            {current.startDate} ~ {current.endDate} · 完成 {current.doneCount}/{current.taskTotal}
            {(current.doneRatio * 100).toFixed(0)}%
          </p>
          <ul className="space-y-1">
            {currentTasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 text-sm">
                <span
                  className={`ac-badge ${
                    t.status === "done" ? "bg-primary-soft text-primary" : "bg-sunken text-ink-soft"
                  }`}
                >
                  {t.status === "done" ? "已完成" : t.status === "doing" ? "进行中" : "待办"}
                </span>
                <a
                  href={`/projects/${projectId}?task=${t.id}`}
                  className="min-w-0 truncate text-ink hover:underline"
                >
                  {t.title}
                </a>
                {t.isBlocked && <span className="text-xs text-high">已阻塞</span>}
              </li>
            ))}
            {currentTasks.length === 0 && (
              <li className="text-sm text-ink-faint">这一轮还没有任务，去详情页从任务池里挑几个。</li>
            )}
          </ul>
        </section>
      ) : (
        <section className="ac-card">
          <h2 className="font-medium text-ink">当前迭代</h2>
          <p className="mt-1 text-sm text-ink-soft">
            还没有进行中的迭代。下面把计划中的一轮「开始」，或者新建一轮。
          </p>
        </section>
      )}

      {canWrite && (
        <section className="ac-card space-y-3">
          <h2 className="font-medium text-ink">新建迭代</h2>
          <form
            action={handleCreate}
            className="grid gap-3 sm:grid-cols-2"
            key={formKey}
          >
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs text-ink-soft">名称</span>
              <input name="name" required maxLength={200} className="ac-field" placeholder="例如 第一轮迭代" />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs text-ink-soft">目标（可留空）</span>
              <textarea name="goal" rows={2} maxLength={10000} className="ac-field" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-ink-soft">开始日期</span>
              <input type="date" name="startDate" required className="ac-field" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-ink-soft">结束日期</span>
              <input type="date" name="endDate" required className="ac-field" />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={busy === "create"}
                className="ac-btn"
                aria-busy={busy === "create"}
              >
                {busy === "create" ? "创建中…" : "创建（计划中）"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="ac-card space-y-3">
        <h2 className="font-medium text-ink">全部迭代</h2>
        {iterations.length === 0 && <p className="text-sm text-ink-faint">还没有迭代。</p>}
        <ul className="divide-y divide-line">
          {iterations.map((it) => (
            <li key={it.id} className="flex flex-wrap items-center gap-2 py-2">
              <span
                className={`ac-badge ${
                  it.status === "active"
                    ? "bg-primary-soft text-primary"
                    : it.status === "completed"
                      ? "bg-sunken text-ink-faint"
                      : "bg-surface text-ink-soft"
                }`}
              >
                {STATUS_LABEL[it.status]}
              </span>
              <a
                href={`/projects/${projectId}/iterations/${it.id}`}
                className="min-w-0 truncate text-sm text-ink hover:underline"
              >
                {it.name}
              </a>
              <span className="text-xs text-ink-faint">
                {it.startDate} ~ {it.endDate}
              </span>
              {canWrite && it.status === "planned" && (
                <span className="ml-auto flex gap-2">
                  <button
                    type="button"
                    disabled={busy === `start:${it.id}`}
                    onClick={() => void handleStart(it)}
                    className="ac-btn"
                  >
                    {busy === `start:${it.id}` ? "开始中…" : "开始"}
                  </button>
                  <button
                    type="button"
                    disabled={busy === `delete:${it.id}`}
                    onClick={() => void handleDelete(it)}
                    className="ac-btn-ghost"
                  >
                    {busy === `delete:${it.id}` ? "删除中…" : "删除"}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="ac-card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium text-ink">任务池</h2>
          <span className="text-xs text-ink-faint">无迭代 · 未完成 · 仅主任务</span>
        </div>
        {backlog.length === 0 && <p className="text-sm text-ink-faint">任务池是空的。</p>}
        <ul className="divide-y divide-line">
          {backlog.map((task, index) => (
            <li key={task.id} className="flex items-center gap-2 py-2">
              <span className="w-6 text-xs text-ink-faint">{index + 1}</span>
              <a
                href={`/projects/${projectId}?task=${task.id}`}
                className="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
              >
                {task.title}
              </a>
              {task.dueDate && <span className="text-xs text-ink-faint">{task.dueDate}</span>}
              {canWrite && (
                <span className="flex gap-1">
                  <button
                    type="button"
                    disabled={index === 0 || busy === `move:${task.id}`}
                    onClick={() => void handleMove(index, -1)}
                    className="ac-btn-ghost px-2"
                    aria-label={`把「${task.title}」上移`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === backlog.length - 1 || busy === `move:${task.id}`}
                    onClick={() => void handleMove(index, 1)}
                    className="ac-btn-ghost px-2"
                    aria-label={`把「${task.title}」下移`}
                  >
                    ↓
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
