"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type {
  IterationCompletionPreview,
  IterationDetail,
  IterationHistory,
  Result,
  TaskSummary,
  UnfinishedDisposition,
} from "@/contracts/p0-p2";
import { newRequestId } from "@/lib/request-id";
import {
  completeIterationAction,
  deletePlannedIterationAction,
  previewIterationCompletionAction,
  saveIterationRetrospectiveAction,
  startIterationAction,
  updateIterationAction,
} from "../actions";
// C-T04/05 归任务侧（定稿 9.2 的固定 Action 路径），不在迭代入口里
import {
  assignTasksToIterationAction,
  removeTasksFromIterationAction,
} from "../../tasks/actions";

// C / P0-P1：单轮迭代的操作台。
//
// 结束迭代是这里唯一有「多步」的地方，也是唯一必须走预览的地方：
// 预览给出未完成主任务与版本基线 → 人逐个定去向 → 连同基线一次性提交。
// 服务端会核对基线是否还成立；不成立就整笔拒绝，这里重新预览，绝不部分落库。

const STATUS_LABEL: Record<IterationDetail["iteration"]["status"], string> = {
  planned: "计划中",
  active: "进行中",
  completed: "已结束",
};

type Dest = { destination: "backlog" | "iteration"; targetIterationId?: string };

function defaultDest(): Dest {
  return { destination: "backlog" };
}

export function IterationDetailView({
  projectId,
  canWrite,
  detail,
  backlog,
  history,
  iterationNames,
}: {
  projectId: string;
  canWrite: boolean;
  detail: IterationDetail;
  backlog: TaskSummary[];
  history: IterationHistory | null;
  /** 迭代 id → 名称。只用来把历史里的「转入哪一轮」显示成人看得懂的名字。 */
  iterationNames: Record<string, string>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const iteration = detail.iteration;
  const locked = iteration.status === "completed";
  /** 加/移任务：planned 与 active 都可以（结束的轮不可）。 */
  const editable = canWrite && !locked;
  /** 改名称/目标/日期：契约只允许 planned。 */
  const canEditFields = canWrite && iteration.status === "planned";

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** 结束流程：预览结果非空即表示「确认面板已展开」。 */
  const [preview, setPreview] = useState<IterationCompletionPreview | null>(null);
  const [dest, setDest] = useState<Record<string, Dest>>({});

  const reload = () => startTransition(() => router.refresh());

  async function run<T>(label: string, fn: () => Promise<Result<T>>): Promise<T | null> {
    setBusy(label);
    setError(null);
    const res = await fn();
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      if (res.code === "CONFLICT") reload();
      return null;
    }
    return res.data;
  }

  /* --- 基础操作 --- */

  async function handleUpdate(form: FormData) {
    const ok = await run("update", () =>
      updateIterationAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: iteration.revision,
        name: String(form.get("name") ?? "").trim(),
        goal: String(form.get("goal") ?? "").trim() || null,
        startDate: String(form.get("startDate") ?? ""),
        endDate: String(form.get("endDate") ?? ""),
      }),
    );
    if (ok) reload();
  }

  async function handleStart() {
    const ok = await run("start", () =>
      startIterationAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: iteration.revision,
      }),
    );
    if (ok) reload();
  }

  async function handleDelete() {
    const ok = await run("delete", () =>
      deletePlannedIterationAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: iteration.revision,
      }),
    );
    // 轮没了，留在本页就是 404；回总览。
    if (ok) router.push(`/projects/${projectId}/iterations`);
  }

  /** 入轮：每个任务带上「用户看到的那个版本」，服务端逐个锁行比对。 */
  async function handleAssign(form: FormData) {
    const picked = new Set(form.getAll("pick").map(String));
    const tasks = backlog
      .filter((t) => picked.has(t.id))
      .map((t) => ({ taskId: t.id, expectedUpdatedAt: t.updatedAt }));
    if (tasks.length === 0) {
      setError("请先勾选要加入本轮的任务");
      return;
    }
    const ok = await run("assign", () =>
      assignTasksToIterationAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: iteration.revision,
        tasks,
      }),
    );
    if (ok) reload();
  }

  async function handleRemove(task: TaskSummary) {
    const ok = await run(`remove:${task.id}`, () =>
      removeTasksFromIterationAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: iteration.revision,
        tasks: [{ taskId: task.id, expectedUpdatedAt: task.updatedAt }],
      }),
    );
    if (ok) reload();
  }

  /* --- 结束迭代 --- */

  async function handleOpenPreview() {
    const data = await run("preview", () =>
      previewIterationCompletionAction(projectId, iteration.id),
    );
    if (!data) return;
    setPreview(data);
    setDest(Object.fromEntries(data.unfinishedTasks.map((t) => [t.id, defaultDest()])));
  }

  async function handleComplete() {
    if (!preview) return;

    const dispositions: UnfinishedDisposition[] = [];
    for (const task of preview.unfinishedTasks) {
      const choice = dest[task.id] ?? defaultDest();
      if (choice.destination === "iteration" && !choice.targetIterationId) {
        setError(`请为「${task.title}」选择要转入的迭代`);
        return;
      }
      dispositions.push(
        choice.destination === "iteration"
          ? {
              taskId: task.id,
              destination: "iteration",
              targetIterationId: choice.targetIterationId!,
            }
          : { taskId: task.id, destination: "backlog" },
      );
    }

    const done = await run("complete", () =>
      completeIterationAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: preview.iterationRevision,
        taskVersions: preview.taskVersions,
        unfinishedDisposition: dispositions,
      }),
    );
    if (!done) {
      // 失败多半是有人在这期间动了任务/迭代：基线已废，重新预览再让用户确认一次。
      setPreview(null);
      setDest({});
      return;
    }
    setPreview(null);
    setDest({});
    reload();
  }

  /* --- 复盘 --- */

  async function handleSaveRetro(form: FormData) {
    const text = (k: string) => String(form.get(k) ?? "").trim() || null;
    const ok = await run("retro", () =>
      saveIterationRetrospectiveAction(projectId, iteration.id, {
        requestId: newRequestId(),
        expectedRevision: detail.retrospective?.revision,
        wentWell: text("wentWell"),
        problems: text("problems"),
        nextActions: text("nextActions"),
      }),
    );
    if (ok) reload();
  }

  const percent = Math.round(detail.stats.doneRatio * 100);
  const titlesById = new Map(
    (history?.taskSnapshots ?? detail.tasks).map((t) => [t.id, t.title]),
  );

  return (
    <div className="space-y-8">
      {error && (
        <p className="ac-card border-high/40 text-sm text-high" role="alert">
          {error}
        </p>
      )}

      <section className="ac-card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`ac-badge ${
              iteration.status === "active"
                ? "bg-primary-soft text-primary"
                : iteration.status === "completed"
                  ? "bg-sunken text-ink-faint"
                  : "bg-surface text-ink-soft"
            }`}
          >
            {STATUS_LABEL[iteration.status]}
          </span>
          <span className="text-xs text-ink-faint">
            {iteration.startDate} ~ {iteration.endDate}
          </span>
          <span className="text-xs text-ink-faint">
            完成 {detail.stats.doneCount}/{detail.stats.taskTotal}（{percent}%）
          </span>
        </div>
        {iteration.goal && <p className="text-sm text-ink-soft">{iteration.goal}</p>}
        {iteration.startedAt && (
          <p className="text-xs text-ink-faint">
            开始于 {iteration.startedAt.slice(0, 10)}
            {iteration.completedAt && ` · 结束于 ${iteration.completedAt.slice(0, 10)}`}
          </p>
        )}

        {editable && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {iteration.status === "planned" && (
              <>
                <button
                  type="button"
                  disabled={busy === "start"}
                  onClick={() => void handleStart()}
                  className="ac-btn"
                >
                  {busy === "start" ? "开始中…" : "开始迭代"}
                </button>
                <button
                  type="button"
                  disabled={busy === "delete"}
                  onClick={() => void handleDelete()}
                  className="ac-btn-ghost"
                >
                  {busy === "delete" ? "删除中…" : "删除这一轮"}
                </button>
              </>
            )}
            {iteration.status === "active" && (
              <button
                type="button"
                disabled={busy === "preview"}
                onClick={() => void handleOpenPreview()}
                className="ac-btn"
              >
                {busy === "preview" ? "读取中…" : "结束迭代…"}
              </button>
            )}
          </div>
        )}
      </section>

      {canEditFields && (
        <section className="ac-card space-y-3">
          <h2 className="font-medium text-ink">编辑迭代</h2>
          <form action={handleUpdate} className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs text-ink-soft">名称</span>
              <input name="name" required maxLength={200} defaultValue={iteration.name} className="ac-field" />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs text-ink-soft">目标</span>
              <textarea
                name="goal"
                rows={2}
                maxLength={10000}
                defaultValue={iteration.goal ?? ""}
                className="ac-field"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-ink-soft">开始日期</span>
              <input type="date" name="startDate" required defaultValue={iteration.startDate} className="ac-field" />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-ink-soft">结束日期</span>
              <input type="date" name="endDate" required defaultValue={iteration.endDate} className="ac-field" />
            </label>
            <div className="sm:col-span-2">
              <button type="submit" disabled={busy === "update"} className="ac-btn">
                {busy === "update" ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </section>
      )}

      {preview && (
        <section className="ac-card space-y-4 border-primary/40">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium text-ink">结束迭代 · 确认未完成任务的去向</h2>
            <button
              type="button"
              onClick={() => {
                setPreview(null);
                setDest({});
              }}
              className="ac-btn-ghost"
            >
              取消
            </button>
          </div>

          <div>
            <h3 className="text-xs text-ink-soft">已完成 {preview.completedTasks.length} 项</h3>
            <ul className="mt-1 space-y-1">
              {preview.completedTasks.map((t) => (
                <li key={t.id} className="truncate text-sm text-ink-faint line-through">
                  {t.title}
                </li>
              ))}
            </ul>
          </div>

          {preview.unfinishedTasks.length === 0 ? (
            <p className="text-sm text-ink-soft">没有未完成的任务，直接结束即可。</p>
          ) : (
            <div className="space-y-2">
              <h3 className="text-xs text-ink-soft">
                未完成 {preview.unfinishedTasks.length} 项 —— 每项都要选去向
              </h3>
              {preview.unfinishedTasks.map((task) => {
                const choice = dest[task.id] ?? defaultDest();
                return (
                  <div key={task.id} className="rounded-field bg-sunken space-y-2 p-3">
                    <p className="truncate text-sm text-ink">{task.title}</p>
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`dest-${task.id}`}
                          checked={choice.destination === "backlog"}
                          onChange={() => setDest((d) => ({ ...d, [task.id]: defaultDest() }))}
                        />
                        退回任务池
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`dest-${task.id}`}
                          checked={choice.destination === "iteration"}
                          onChange={() =>
                            setDest((d) => ({
                              ...d,
                              [task.id]: {
                                destination: "iteration",
                                targetIterationId: preview.eligibleNextIterations[0]?.id,
                              },
                            }))
                          }
                        />
                        转入
                        <select
                          value={choice.targetIterationId ?? ""}
                          disabled={choice.destination !== "iteration"}
                          onChange={(e) =>
                            setDest((d) => ({
                              ...d,
                              [task.id]: { destination: "iteration", targetIterationId: e.target.value },
                            }))
                          }
                          className="ac-field py-1"
                        >
                          <option value="">选择迭代…</option>
                          {preview.eligibleNextIterations.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name}（{STATUS_LABEL[it.status]}）
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy === "complete"}
              onClick={() => void handleComplete()}
              className="ac-btn"
            >
              {busy === "complete" ? "结束中…" : "确认结束这一轮"}
            </button>
            {preview.eligibleNextIterations.length === 0 && preview.unfinishedTasks.length > 0 && (
              <span className="text-xs text-ink-faint">
                同项目下还没有别的未结束迭代，未完成的任务只能退回任务池。
              </span>
            )}
          </div>
        </section>
      )}

      {/* 已结束的轮，任务由下面的「历史快照」一节负责展示（同一份快照，不重复列两遍）。 */}
      {(!locked || !history) && (
      <section className="ac-card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium text-ink">本轮任务（{detail.tasks.length}）</h2>
          {locked && <span className="text-xs text-ink-faint">已结束，列表只读</span>}
        </div>
        {detail.tasks.length === 0 && <p className="text-sm text-ink-faint">这一轮还没有任务。</p>}
        <ul className="divide-y divide-line">
          {detail.tasks.map((task) => (
            <li key={task.id} className="flex flex-wrap items-center gap-2 py-2">
              <span
                className={`ac-badge ${
                  task.status === "done" ? "bg-primary-soft text-primary" : "bg-sunken text-ink-soft"
                }`}
              >
                {task.status === "done" ? "已完成" : task.status === "doing" ? "进行中" : "待办"}
              </span>
              <a
                href={`/projects/${projectId}?task=${task.id}`}
                className="min-w-0 flex-1 truncate text-sm text-ink hover:underline"
              >
                {task.title}
              </a>
              {task.assigneeName && <span className="text-xs text-ink-faint">{task.assigneeName}</span>}
              {task.isBlocked && <span className="text-xs text-high">已阻塞</span>}
              {editable && (
                <button
                  type="button"
                  disabled={busy === `remove:${task.id}`}
                  onClick={() => void handleRemove(task)}
                  className="ac-btn-ghost"
                >
                  {busy === `remove:${task.id}` ? "移出中…" : "移出本轮"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
      )}

      {editable && (
        <section className="ac-card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium text-ink">从任务池加入</h2>
            <span className="text-xs text-ink-faint">无迭代 · 未完成 · 仅主任务</span>
          </div>
          {backlog.length === 0 ? (
            <p className="text-sm text-ink-faint">任务池是空的。</p>
          ) : (
            <form action={handleAssign} className="space-y-3">
              <ul className="divide-y divide-line">
                {backlog.map((task) => (
                  <li key={task.id} className="flex items-center gap-2 py-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input type="checkbox" name="pick" value={task.id} />
                      <span className="min-w-0 truncate text-sm text-ink">{task.title}</span>
                    </label>
                    {task.dueDate && <span className="text-xs text-ink-faint">{task.dueDate}</span>}
                  </li>
                ))}
              </ul>
              <button type="submit" disabled={busy === "assign"} className="ac-btn">
                {busy === "assign" ? "加入中…" : "把勾选的加入本轮"}
              </button>
            </form>
          )}
        </section>
      )}

      {locked && history && (
        <section className="ac-card space-y-3">
          <h2 className="font-medium text-ink">历史快照</h2>
          <p className="text-xs text-ink-faint">
            结束于 {history.closedAt.slice(0, 10)} · 当时完成 {history.stats.doneCount}/
            {history.stats.taskTotal}（{Math.round(history.stats.doneRatio * 100)}%）
          </p>
          <p className="text-xs text-ink-faint">
            快照保存的是结束那一刻的任务标题与状态，之后任务被改名、完成或删除都不会重算这里。
          </p>
          <ul className="divide-y divide-line">
            {history.taskSnapshots.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="text-xs text-ink-faint">
                  {t.status === "done" ? "已完成" : t.status === "doing" ? "进行中" : "待办"}
                </span>
                <span className={`min-w-0 flex-1 truncate ${t.status === "done" ? "text-ink-faint" : "text-ink"}`}>
                  {t.title}
                </span>
                {t.assigneeName && <span className="text-xs text-ink-faint">{t.assigneeName}</span>}
              </li>
            ))}
          </ul>
          {history.dispositions.length > 0 && (
            <div>
              <h3 className="text-xs text-ink-soft">结束时的未完成去向</h3>
              <ul className="mt-1 space-y-1 text-sm text-ink-soft">
                {history.dispositions.map((d) => (
                  <li key={d.taskId} className="truncate">
                    {titlesById.get(d.taskId) ?? d.taskId} →{" "}
                    {d.destination === "backlog"
                      ? "退回任务池"
                      : `转入「${
                          (d.targetIterationId && iterationNames[d.targetIterationId]) || "另一轮迭代"
                        }」`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {locked && (
        <section className="ac-card space-y-3">
          <h2 className="font-medium text-ink">复盘</h2>
          {canWrite ? (
            <form
              action={handleSaveRetro}
              className="space-y-3"
              key={detail.retrospective?.revision ?? 0}
            >
              <label className="block space-y-1">
                <span className="text-xs text-ink-soft">做得好的</span>
                <textarea
                  name="wentWell"
                  rows={2}
                  maxLength={10000}
                  defaultValue={detail.retrospective?.wentWell ?? ""}
                  className="ac-field"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-ink-soft">遇到的问题</span>
                <textarea
                  name="problems"
                  rows={2}
                  maxLength={10000}
                  defaultValue={detail.retrospective?.problems ?? ""}
                  className="ac-field"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-ink-soft">下一轮改进</span>
                <textarea
                  name="nextActions"
                  rows={2}
                  maxLength={10000}
                  defaultValue={detail.retrospective?.nextActions ?? ""}
                  className="ac-field"
                />
              </label>
              <button type="submit" disabled={busy === "retro"} className="ac-btn">
                {busy === "retro" ? "保存中…" : detail.retrospective ? "保存复盘" : "写下复盘"}
              </button>
            </form>
          ) : detail.retrospective ? (
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-ink-soft">做得好的</dt>
                <dd className="text-ink">{detail.retrospective.wentWell ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">遇到的问题</dt>
                <dd className="text-ink">{detail.retrospective.problems ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-soft">下一轮改进</dt>
                <dd className="text-ink">{detail.retrospective.nextActions ?? "—"}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-ink-faint">还没有复盘。</p>
          )}
        </section>
      )}
    </div>
  );
}
