"use client";

import { useOptimistic, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { z } from "zod";
import { deriveColumns, type BoardColumn, type ColumnPatch } from "@/lib/board-columns";
import type { GroupBy } from "@/lib/board-filters";
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel";
import { moveTaskAction } from "./actions";
import { TaskCard, type Option } from "./task-card";

export type BoardTask = {
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: "todo" | "doing" | "done";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  labels: { id: string; name: string; color: string }[];
};

function Column({
  column,
  tasks,
  canWrite,
  allTasks,
  dependencies,
  onOpenTask,
}: {
  column: BoardColumn;
  tasks: BoardTask[];
  canWrite: boolean;
  allTasks: { id: string; title: string }[];
  dependencies: { predecessorId: string; successorId: string }[];
  onOpenTask: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-40 w-72 shrink-0 space-y-2 rounded-xl border border-line p-3 transition-colors ${
        isOver ? "bg-primary-soft" : "bg-sunken"
      }`}
    >
      <h3 className={`flex items-center gap-2 text-sm font-semibold ${column.tone}`}>
        {column.label}
        <span className="ac-badge bg-surface text-ink-soft">{tasks.length}</span>
      </h3>
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          canWrite={canWrite}
          allTasks={allTasks}
          dependencies={dependencies}
          onOpen={() => onOpenTask(t.id)}
        />
      ))}
    </div>
  );
}

export function Board({
  projectId,
  tasks,
  groupBy,
  canWrite,
  members,
  milestones,
  allTasks,
  dependencies,
}: {
  projectId: string;
  tasks: BoardTask[];
  groupBy: GroupBy;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  dependencies: { predecessorId: string; successorId: string }[];
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimisticTasks, moveOptimistic] = useOptimistic(
    tasks,
    (current, move: { taskId: string; patch: ColumnPatch }) =>
      current.map((t) => (t.id === move.taskId ? { ...t, ...move.patch } : t)),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const columns = deriveColumns(groupBy, { members, milestones });

  // 详情侧边栏是**全局单例**：不能 30 张卡片各挂一个。
  // 它由 URL 的 ?task= 驱动——打开就是往 URL 写 task，关闭就是删掉它，
  // 所以刷新/后退/分享链接都自然正确；数据由面板自己按 taskId 取（定稿 9.2 的侧边栏契约）。
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function writeTaskQuery(taskId: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (taskId) params.set("task", taskId);
    else params.delete("task");
    const qs = params.toString();
    startTransition(() => {
      // replace 而非 push：开开关关面板不该堆满历史记录，但筛选参数要保留
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  const openPanel = (taskId: string) => writeTaskQuery(taskId);
  const closePanel = () => writeTaskQuery(null);
  /** 面板保存成功后回头刷新看板卡片与筛选计数（面板自己的数据它自己已重取）。 */
  const reload = () => startTransition(() => router.refresh());

  // ?task= 得是个 uuid 才当「要开面板」——和深链校验同一口径，免得垃圾参数挂出一个必然报错的面板。
  const rawTaskId = searchParams.get("task");
  const openTaskId =
    rawTaskId !== null && z.uuid().safeParse(rawTaskId).success ? rawTaskId : null;

  function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id);
    const over = event.over?.id;
    if (!over) return;
    const column = columns.find((c) => c.key === String(over));
    const task = optimisticTasks.find((t) => t.id === taskId);
    // 已在目标列则无须提交
    if (!column || !task || column.matches(task)) return;

    startTransition(async () => {
      setError(null);
      moveOptimistic({ taskId, patch: column.patch });
      const res = await moveTaskAction({ taskId, projectId, patch: column.patch });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <DndContext id={`board-${projectId}`} sensors={sensors} onDragEnd={handleDragEnd}>
      {error && <p className="text-sm text-high">{error}</p>}
      {/* 列数随分组维度而变，故横向滚动而非固定三栏 */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {columns.map((col) => (
          <Column
            key={col.key}
            column={col}
            tasks={optimisticTasks.filter((t) => col.matches(t))}
            canWrite={canWrite}
            allTasks={allTasks}
            dependencies={dependencies}
            onOpenTask={openPanel}
          />
        ))}
      </div>

      {openTaskId && (
        <TaskDetailPanel
          projectId={projectId}
          taskId={openTaskId}
          onClose={closePanel}
          onSaved={reload}
        />
      )}
    </DndContext>
  );
}
