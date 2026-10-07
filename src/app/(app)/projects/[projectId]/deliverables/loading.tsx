/** 成果列表加载态：真实骨架，避免把“正在加载”误看成“没有成果”。 */
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
      <div className="h-8 w-32 animate-pulse rounded-field bg-sunken" />
      <ul className="space-y-3">
        {[0, 1, 2].map((index) => (
          <li key={index} className="ac-card h-20 animate-pulse" />
        ))}
      </ul>
      <p role="status" className="text-center text-xs text-ink-faint">
        正在加载阶段成果…
      </p>
    </main>
  );
}
