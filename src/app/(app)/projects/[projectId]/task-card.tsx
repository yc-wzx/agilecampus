"use client";

import { useDraggable } from "@dnd-kit/core";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import type { BoardTask } from "./board";

export type Option = { id: string; name: string };
type TaskOption = { id: string; title: string };

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-high-soft text-high",
  medium: "bg-medium-soft text-medium",
  low: "bg-low-soft text-low",
};

export function TaskCard({
  task,
  canWrite,
  allTasks,
  dependencies,
  onOpen,
}: {
  task: BoardTask;
  canWrite: boolean;
  allTasks: TaskOption[];
  dependencies: { predecessorId: string; successorId: string }[];
  onOpen: () => void;
}) {
  // 详情面板由 Board 统一托管（全局单例），卡片只负责「报告被点了」。
  // 深链 ?task= 的读取也上提到了 Board，卡片不再是 URL 的消费者。
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canWrite,
  });
  const successorTitles = dependencies
    .filter((d) => d.predecessorId === task.id)
    .map((d) => allTasks.find((t) => t.id === d.successorId)?.title)
    .filter(Boolean);

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={`ac-card p-3 text-sm transition hover:shadow-md ${isDragging ? "opacity-50" : ""}`}
    >
      <div {...listeners} {...attributes} className={canWrite ? "cursor-grab" : ""}>
        <button
          type="button"
          // 阻止冒泡：拖拽把手覆盖了整张卡片，点标题不能被当成开始拖拽
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onOpen}
          className="block w-full text-left font-medium text-ink hover:text-primary hover:underline"
        >
          {task.title}
        </button>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
          <span>{task.assigneeName ?? "未分配"}</span>
          {(task.startDate || task.dueDate) && (
            <span>· {task.startDate ?? "…"}→{task.dueDate ?? "…"}</span>
          )}
          <span className={`ac-badge ${PRIORITY_BADGE[task.priority] ?? "bg-low-soft text-low"}`}>
            {task.priority}
          </span>
        </p>
        {task.labels.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1">
            {task.labels.slice(0, 3).map((l) => (
              <span
                key={l.id}
                className={`ac-badge ${LABEL_COLOR_CLASS[l.color] ?? LABEL_COLOR_CLASS.slate}`}
              >
                {l.name}
              </span>
            ))}
            {task.labels.length > 3 && (
              <span className="text-xs text-ink-faint">+{task.labels.length - 3}</span>
            )}
          </p>
        )}
        {task.description && (
          <p className="mt-1 text-xs text-ink-soft line-clamp-2">{task.description}</p>
        )}
        {task.status === "done" && task.completionNote && (
          <p className="mt-1 rounded bg-done/10 px-2 py-1 text-xs text-done">
            完成情况：{task.completionNote}
          </p>
        )}
        {successorTitles.length > 0 && (
          <p className="mt-1 text-xs text-ink-faint">后置：{successorTitles.join("、")}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-2 text-xs text-ink-faint hover:text-primary hover:underline"
      >
        {canWrite ? "编辑" : "详情"}
      </button>
    </div>
  );
}
