/** 成果详情加载态。 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-3xl space-y-5 py-8">
      <div className="flex flex-wrap items-center gap-1.5">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="h-8 w-16 animate-pulse rounded-field bg-sunken"
          />
        ))}
      </div>
      <div className="h-8 w-2/3 animate-pulse rounded-field bg-sunken" />
      <div className="ac-card h-36 animate-pulse" />
      <div className="ac-card h-32 animate-pulse" />
      <p role="status" className="text-center text-xs text-ink-faint">
        正在加载成果详情…
      </p>
    </main>
  );
}
