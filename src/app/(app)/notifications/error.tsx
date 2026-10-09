"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <p className="text-sm text-red-700">通知加载失败</p>
      <button onClick={reset} className="mt-2 rounded border px-2 py-1 text-sm">重试</button>
    </main>
  );
}
