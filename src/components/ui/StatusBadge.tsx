const STYLES: Record<string, string> = {
  todo: "bg-slate-100 text-slate-600",
  doing: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  active: "bg-green-100 text-green-700",
  archived: "bg-slate-100 text-slate-500",
  open: "bg-blue-100 text-blue-700",
  draft: "bg-slate-100 text-slate-600",
  submitted: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  changes_requested: "bg-red-100 text-red-700",
};

const LABELS: Record<string, string> = {
  todo: "待开始",
  doing: "进行中",
  done: "已完成",
  active: "进行中",
  archived: "已归档",
  open: "进行中",
  draft: "草稿",
  submitted: "待验收",
  approved: "已通过",
  changes_requested: "需修改",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-slate-100 text-slate-600";
  const label = LABELS[status] ?? status;

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}
    >
      {label}
    </span>
  );
}
