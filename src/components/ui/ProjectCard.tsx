import Link from "next/link";

type ProjectCardProps = {
  projectId: string;
  name: string;
  description: string | null;
  taskDone: number;
  taskTotal: number;
  pendingDeliverables: number;
  href?: string;
};

export function ProjectCard({
  projectId,
  name,
  description,
  taskDone,
  taskTotal,
  pendingDeliverables,
  href,
}: ProjectCardProps) {
  return (
    <Link
      href={href ?? `/projects/${projectId}`}
      className="block rounded-lg border border-slate-200 bg-white p-5 transition hover:border-slate-300 hover:shadow-sm"
    >
      <h3 className="text-sm font-medium text-slate-900">{name}</h3>
      {description && (
        <p className="mt-1 line-clamp-2 text-xs text-slate-500">
          {description}
        </p>
      )}
      <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
        <span>
          任务 {taskDone}/{taskTotal}
        </span>
        {pendingDeliverables > 0 && (
          <span className="text-amber-600">
            待验收 {pendingDeliverables}
          </span>
        )}
      </div>
    </Link>
  );
}
