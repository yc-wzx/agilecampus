/** 证据页加载态。 */
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
      <div className="h-8 w-40 animate-pulse rounded-field bg-sunken" />
      <div className="ac-card h-40 animate-pulse" />
      <ul className="space-y-3">
        {[0, 1, 2].map((index) => (
          <li key={index} className="ac-card h-24 animate-pulse" />
        ))}
      </ul>
      <p role="status" className="text-center text-xs text-ink-faint">
        正在加载成果证据…
      </p>
    </main>
  );
}
