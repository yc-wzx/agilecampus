import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listNotifications } from "@/lib/notifications";

export default async function Page() {
  const s = await auth();
  if (!s?.user?.id) redirect("/login");
  const rows = await listNotifications(s.user.id);

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-xl font-semibold">通知</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">暂无通知</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <li key={n.id} className={`rounded border p-3 ${n.readAt ? "" : "bg-blue-50"}`}>
              <a href={n.href} className="font-medium hover:underline">{n.title}</a>
              {n.summary ? <p className="text-sm text-gray-600">{n.summary}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
