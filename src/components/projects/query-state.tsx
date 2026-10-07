/**
 * 聚合中某个数据源不可用时的统一占位（第 3.3 / 9.1 节）。
 *
 * 只用于 QueryPart 的 unavailable 分支：把“取不到”如实显示出来，
 * 且不影响同一页面上其它已经 ready 的数据源。
 */
export function QueryUnavailable({
  title,
  message,
  hint,
}: {
  title: string;
  message: string;
  hint?: string;
}) {
  return (
    <section className="ac-card p-5">
      <h2 className="text-sm text-ink-soft">{title}</h2>
      <p className="mt-2 text-sm text-ink-soft">该数据暂时不可用，页面其余部分不受影响。</p>
      <p className="mt-1 break-words text-xs text-ink-faint">{message}</p>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </section>
  );
}
