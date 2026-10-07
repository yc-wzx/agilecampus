/** 项目概览加载态：真实骨架，不显示上一次的旧数据。 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 py-8">
      <div className="flex flex-wrap items-center gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="h-8 w-16 animate-pulse rounded-field bg-sunken"
          />
        ))}
      </div>
      <div className="ac-card h-32 animate-pulse" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="ac-card h-40 animate-pulse" />
        <div className="ac-card h-40 animate-pulse" />
      </div>
      <div className="ac-card h-48 animate-pulse" />
      <p role="status" className="text-center text-xs text-ink-faint">
        正在加载项目概览…
      </p>
    </main>
  );
}
