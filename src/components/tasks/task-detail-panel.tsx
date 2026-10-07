"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { TaskPriorityValue, TaskPanelData, TaskStatusValue } from "@/contracts/p0-p2";
import {
  updateTaskAction,
  type UpdateTaskState,
} from "@/app/(app)/projects/[projectId]/actions";
import {
  deleteTaskV1Action,
  getTaskPanelContextAction,
  setTaskBlockedAction,
  updateTaskV1Action,
} from "@/app/(app)/projects/[projectId]/tasks/actions";
import type { TaskSummary } from "@/contracts/p0-p2";
import { newRequestId } from "@/lib/request-id";

// C / P0：任务详情侧边栏。取代原先卡片里的居中弹窗 EditModal。
//
// 契约（定稿 9.2）：`TaskDetailPanel({projectId,taskId,onClose,onSaved})`——
// **面板自己取数**：挂载时与 taskId 变化时各调一次 getTaskPanelContextAction，
// 每次都重新鉴权，不信任调用方传来的任务内容；也因此谁都能只拿两个 id 把它挂起来。
// `onSaved` 只在服务端确认写入成功后触发，给父级刷新看板卡片用。
//
// 打开/关闭仍由父级（看板）通过 URL 的 ?task= 驱动，面板不管这件事。
//
// 保存带回载入时拿到的 expectedUpdatedAt，由服务端在事务内锁行比对（定稿 §9.1）；
// CONFLICT 时如实提示并**自己重取**，绝不假装保存成功。

export type PanelOption = { id: string; name: string };

/**
 * D 的来源反馈（来源条目挂到任务上）。只取展示需要的字段，且时间是 ISO 串——
 * 客户端组件不该依赖服务端 lib 的行类型。
 */
export type TaskFeedbackItem = {
  id: string;
  decision: string;
  comment: string;
  milestoneTitle: string | null;
  createdAt: string;
};

/** 面板渲染所需的全部数据。data 与 error 恰有一个非空。 */
export type TaskPanelState = {
  taskId: string;
  data: TaskPanelData | null;
  error: string | null;
};

/** getTaskPanelContextAction 的返回：详情 + 表单选项 + D 的来源反馈。 */
export type TaskPanelContext = {
  panel: TaskPanelData;
  canWrite: boolean;
  members: PanelOption[];
  milestones: PanelOption[];
  allTasks: { id: string; title: string }[];
  allLabels: PanelOption[];
  feedback: TaskFeedbackItem[];
};

function textOrNull(form: FormData, key: string): string | null {
  const raw = form.get(key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

const STATUS_LABEL: Record<TaskStatusValue, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

export function TaskDetailPanel({
  projectId,
  taskId,
  onClose,
  onSaved,
}: {
  projectId: string;
  taskId: string;
  onClose: () => void;
  /** 服务端确认写入成功后触发，供父级刷新看板。失败与冲突都不会触发。 */
  onSaved?: () => void;
}) {
  /** 自取数结果。切换 taskId 时旧数据不再匹配，由下面的 ctx 判定作废。 */
  const [fetched, setFetched] = useState<TaskPanelContext | null>(null);
  const [fetchFailed, setFetchFailed] = useState<string | null>(null);
  /** 变化的只有它时重取（保存后、冲突后、以及手工重试）。 */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // 挂载与 taskId 切换都要重新鉴权取数——这是契约里写死的行为。
    getTaskPanelContextAction(projectId, taskId).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setFetched(null);
        setFetchFailed(res.error);
        return;
      }
      setFetchFailed(null);
      setFetched(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, nonce]);

  const refetch = () => setNonce((n) => n + 1);

  // 取回来的必须正是当前这个任务，否则就当还没到——切换任务的瞬间不会闪出上一个任务的详情。
  const ctx = fetched && fetched.panel.task.id === taskId ? fetched : null;
  const state: TaskPanelState = ctx
    ? { taskId, data: ctx.panel, error: null }
    : { taskId, data: null, error: fetchFailed };

  // 本地副本让保存后能立刻回显新值，不必等重新取数；服务端一到新数据就同步过来。
  const [local, setLocal] = useState(state.data);
  const [prevData, setPrevData] = useState(state.data);
  // 渲染期同步而非 useEffect：这是「props 变了就调整派生 state」的既有写法（原深链逻辑同款），
  // 放在 effect 里会多一轮渲染，也会触发 eslint 的 set-state-in-effect。
  if (state.data !== prevData) {
    setPrevData(state.data);
    setLocal(state.data);
  }

  const canWrite = ctx?.canWrite ?? false;
  const members = ctx?.members ?? [];
  const milestones = ctx?.milestones ?? [];
  const allTasks = ctx?.allTasks ?? [];
  const allLabels = ctx?.allLabels ?? [];
  const feedback = ctx?.feedback ?? [];

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 打开时记住焦点，关闭时还回去——侧边栏关掉后键盘用户应回到原来那张卡片。
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const task = local?.task ?? null;

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!local) return;
    const form = new FormData(event.currentTarget);

    setSaving(true);
    setSaveError(null);
    const res = await updateTaskV1Action(projectId, taskId, {
      requestId: newRequestId(),
      // 原样回传服务端给的时间串，绝不在浏览器侧重新生成
      expectedUpdatedAt: local.task.updatedAt,
      patch: {
        title: String(form.get("title") ?? "").trim(),
        description: textOrNull(form, "description"),
        acceptanceCriteria: textOrNull(form, "acceptanceCriteria"),
        completionNote: textOrNull(form, "completionNote"),
        assigneeId: textOrNull(form, "assigneeId"),
        milestoneId: textOrNull(form, "milestoneId"),
        status: form.get("status") as TaskStatusValue,
        priority: form.get("priority") as TaskPriorityValue,
        startDate: textOrNull(form, "startDate"),
        dueDate: textOrNull(form, "dueDate"),
      },
    });
    setSaving(false);

    if (!res.ok) {
      setSaveError(res.error);
      // 版本对不上说明别人先改了：拉一份最新的，别让用户对着旧数据继续改
      if (res.code === "CONFLICT") refetch();
      return;
    }
    setLocal((current) => (current ? { ...current, task: res.data.task } : current));
    // 只有这里——服务端确认成功之后——才通知外部
    onSaved?.();
  }

  async function handleDelete() {
    if (!local) return;
    if (!confirm("确认删除该任务？此操作不可恢复。")) return;
    setDeleting(true);
    setSaveError(null);
    const res = await deleteTaskV1Action(projectId, taskId, {
      requestId: newRequestId(),
      expectedUpdatedAt: local.task.updatedAt,
    });
    setDeleting(false);
    if (!res.ok) {
      setSaveError(res.error);
      if (res.code === "CONFLICT") refetch();
      return;
    }
    onSaved?.();
    onClose();
  }

  /** 子面板（标签/依赖）保存成功：重取自己，并让父级刷新看板上的标签与依赖计数。 */
  function handleLabelDependencySaved() {
    setSaveError(null);
    refetch();
    onSaved?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="任务详情"
    >
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-ink/40 backdrop-blur-sm"
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface p-5 shadow-pop">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-ink-faint">任务详情</p>
            <h3 className="break-words font-display text-base font-semibold text-ink">
              {task?.title ?? "任务"}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-field text-ink-faint hover:bg-sunken hover:text-ink"
          >
            ✕
          </button>
        </header>

        {state.error && (
          <div className="space-y-2">
            <p className="text-sm text-high">{state.error}</p>
            <button type="button" onClick={refetch} className="ac-btn-ghost text-sm">
              重试
            </button>
          </div>
        )}

        {!state.error && !state.data && <p className="text-sm text-ink-faint">载入任务详情…</p>}

        {task && local && (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <Meta label="状态" value={STATUS_LABEL[task.status]} />
              <Meta label="优先级" value={task.priority} />
              <Meta label="负责人" value={task.assigneeName ?? "未分配"} />
              <Meta label="所属迭代" value={task.iterationId ? "已入轮" : "未入轮"} />
              <Meta label="起始日" value={task.startDate ?? "—"} />
              <Meta label="截止日" value={task.dueDate ?? "—"} />
            </dl>

            {local.labels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {local.labels.map((l) => (
                  <span key={l.id} className="ac-badge bg-surface text-ink-soft">
                    {l.name}
                  </span>
                ))}
              </div>
            )}

            <p className="text-xs text-ink-faint">
              子任务 {local.subtaskProgress.doneCount}/{local.subtaskProgress.total}
              {local.subtaskProgress.ratio !== null &&
                ` · ${Math.round(local.subtaskProgress.ratio * 100)}%`}
              {" · "}依赖 {local.dependencies.length} 条
            </p>

            {canWrite && local.allowedActions.edit ? (
              <form
                // 服务端每次回来的 updatedAt 都不同：用它当 key，冲突刷新后表单会重挂载，
                // 输入框回到最新值，而不是留着用户手里那份过期内容。
                key={task.updatedAt}
                onSubmit={handleSave}
                className="space-y-2.5 border-t border-line pt-4"
              >
                <Field label="标题">
                  <input name="title" defaultValue={task.title} required className="ac-field text-sm" />
                </Field>
                <Field label="描述">
                  <textarea
                    name="description"
                    defaultValue={task.description ?? ""}
                    rows={2}
                    className="ac-field text-sm"
                    placeholder="任务描述"
                  />
                </Field>
                <Field label="验收标准">
                  <textarea
                    name="acceptanceCriteria"
                    defaultValue={task.acceptanceCriteria ?? ""}
                    rows={3}
                    className="ac-field text-sm"
                    placeholder="做到什么程度算完成"
                  />
                </Field>
                <Field label="完成情况（完成时填写）">
                  <textarea
                    name="completionNote"
                    defaultValue={task.completionNote ?? ""}
                    rows={2}
                    className="ac-field text-sm"
                    placeholder="完成说明"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="状态">
                    <select name="status" defaultValue={task.status} className="ac-field text-sm">
                      <option value="todo">待办</option>
                      <option value="doing">进行中</option>
                      <option value="done">已完成</option>
                    </select>
                  </Field>
                  <Field label="优先级">
                    <select name="priority" defaultValue={task.priority} className="ac-field text-sm">
                      <option value="low">低</option>
                      <option value="medium">中</option>
                      <option value="high">高</option>
                    </select>
                  </Field>
                  <Field label="负责人">
                    <select name="assigneeId" defaultValue={task.assigneeId ?? ""} className="ac-field text-sm">
                      <option value="">未分配</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="里程碑">
                    <select name="milestoneId" defaultValue={task.milestoneId ?? ""} className="ac-field text-sm">
                      <option value="">无里程碑</option>
                      {milestones.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="起始日">
                    <input type="date" name="startDate" defaultValue={task.startDate ?? ""} className="ac-field text-sm" />
                  </Field>
                  <Field label="截止日">
                    <input type="date" name="dueDate" defaultValue={task.dueDate ?? ""} className="ac-field text-sm" />
                  </Field>
                </div>

                {saveError && <p className="text-sm text-high">{saveError}</p>}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button type="button" onClick={onClose} className="ac-btn-ghost">
                    关闭
                  </button>
                  <button disabled={saving} className="ac-btn">
                    {saving ? "保存中…" : "保存"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-2 border-t border-line pt-4 text-sm">
                <p className="whitespace-pre-wrap text-ink-soft">{task.description ?? "（无描述）"}</p>
                {task.acceptanceCriteria && (
                  <p className="text-xs text-ink-soft">验收标准：{task.acceptanceCriteria}</p>
                )}
                {!canWrite && <p className="text-xs text-ink-faint">你的角色只能查看任务。</p>}
              </div>
            )}

            {canWrite && local.allowedActions.edit && (
              <BlockControl
                projectId={projectId}
                taskId={task.id}
                task={task}
                onUpdated={(next) =>
                  setLocal((current) => (current ? { ...current, task: next } : current))
                }
                onReload={() => {
                  refetch();
                  // 阻塞状态看板卡片上要看得到，所以顺带请父级刷新
                  onSaved?.();
                }}
              />
            )}

            {feedback.length > 0 && (
              <div className="space-y-2 border-t border-line pt-4">
                <p className="text-xs font-medium text-ink-soft">来源反馈</p>
                {feedback.map((f) => (
                  <div key={f.id} className="rounded-field bg-sunken p-2.5">
                    <p className="text-xs text-ink-faint">
                      {f.milestoneTitle ?? "成果反馈"} ·{" "}
                      {f.decision === "changes_requested" ? "退回修改" : "通过"} ·{" "}
                      {f.createdAt.slice(0, 10)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{f.comment}</p>
                  </div>
                ))}
              </div>
            )}

            {canWrite && local.allowedActions.edit && (
              <LabelDependencyForm
                projectId={projectId}
                taskId={task.id}
                taskTitle={task.title}
                currentLabelIds={local.labels.map((l) => l.id)}
                currentSuccessorIds={local.dependencies
                  .filter((d) => d.predecessorId === task.id)
                  .map((d) => d.successorId)}
                allLabels={allLabels}
                allTasks={allTasks}
                onSaved={handleLabelDependencySaved}
              />
            )}

            {/* D 的来源反馈、E 的评论与活动接在这里；两者都还没交付，先留位不假装有。 */}

            {canWrite && local.allowedActions.delete && (
              <div className="border-t border-line pt-3">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                  className="text-xs text-high underline disabled:opacity-50"
                >
                  {deleting ? "删除中…" : "删除任务"}
                </button>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * 阻塞 / 解除阻塞。
 *
 * 单独走 setTaskBlockedAction 而不是塞进上面的保存表单：这三个字段在服务层是「一起写」的，
 * 混进通用 patch 会让「改了状态顺手把阻塞也清了」这种事变得可能。所以刻意分成两个动作。
 */
function BlockControl({
  projectId,
  taskId,
  task,
  onUpdated,
  onReload,
}: {
  projectId: string;
  taskId: string;
  task: TaskSummary;
  onUpdated: (task: TaskSummary) => void;
  onReload: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(blocked: boolean) {
    setPending(true);
    setError(null);
    const res = await setTaskBlockedAction(projectId, taskId, {
      requestId: newRequestId(),
      expectedUpdatedAt: task.updatedAt,
      isBlocked: blocked,
      blockedReason: blocked ? reason : null,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      if (res.code === "CONFLICT") onReload();
      return;
    }
    setReason("");
    onUpdated(res.data.task);
    onReload();
  }

  if (task.isBlocked) {
    return (
      <div className="space-y-2 border-t border-line pt-4">
        <p className="text-xs font-medium text-ink-soft">已阻塞</p>
        <p className="text-sm text-ink">{task.blockedReason}</p>
        <p className="text-xs text-ink-faint">
          自 {task.blockedAt?.slice(0, 10) ?? "—"}
        </p>
        {error && <p className="text-sm text-high">{error}</p>}
        <button
          type="button"
          disabled={pending}
          onClick={() => void submit(false)}
          className="ac-btn-ghost text-sm"
        >
          {pending ? "处理中…" : "解除阻塞"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <Field label="标记阻塞">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="被什么卡住了（必填）"
          className="ac-field text-sm"
        />
      </Field>
      {error && <p className="text-sm text-high">{error}</p>}
      <button
        type="button"
        disabled={pending || reason.trim() === ""}
        onClick={() => void submit(true)}
        className="ac-btn-ghost text-sm"
      >
        {pending ? "处理中…" : "标记为阻塞"}
      </button>
    </div>
  );
}

/**
 * 标签与依赖仍走旧的对象表单 Action。
 * 这两块由既有 CRUD 承担（定稿要求「复用原 CRUD」），V1 契约里没有对应字段，
 * 所以不重造轮子；保存成功后让父级重新取数即可。
 */
function LabelDependencyForm({
  projectId,
  taskId,
  taskTitle,
  currentLabelIds,
  currentSuccessorIds,
  allLabels,
  allTasks,
  onSaved,
}: {
  projectId: string;
  taskId: string;
  taskTitle: string;
  currentLabelIds: string[];
  currentSuccessorIds: string[];
  allLabels: PanelOption[];
  allTasks: { id: string; title: string }[];
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState<UpdateTaskState, FormData>(
    updateTaskAction,
    null,
  );
  const settled = state !== null;
  const notified = useRef(false);

  useEffect(() => {
    if (!settled || notified.current) return;
    notified.current = true;
    if (state && "ok" in state) onSaved();
  }, [settled, state, onSaved]);

  const error = state && "error" in state ? state.error : null;

  return (
    <form action={formAction} className="space-y-2.5 border-t border-line pt-4">
      <input type="hidden" name="taskId" value={taskId} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="title" value={taskTitle} />

      {allLabels.length > 0 && (
        <Field label="标签（可多选）">
          <select
            multiple
            name="labelIds"
            defaultValue={currentLabelIds}
            className="ac-field text-sm"
            size={Math.min(4, Math.max(2, allLabels.length))}
          >
            {allLabels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="后置任务（可多选）">
        <select
          multiple
          name="successorIds"
          defaultValue={currentSuccessorIds}
          className="ac-field text-sm"
          size={Math.min(4, Math.max(2, Math.max(allTasks.length - 1, 2)))}
        >
          {allTasks
            .filter((t) => t.id !== taskId)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
        </select>
      </Field>

      {error && <p className="text-sm text-high">{error}</p>}

      <div className="flex justify-end">
        <button disabled={pending} className="ac-btn-ghost text-sm">
          {pending ? "保存中…" : "保存标签与依赖"}
        </button>
      </div>
    </form>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
