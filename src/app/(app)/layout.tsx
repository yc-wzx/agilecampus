import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3 sm:gap-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center rounded-md bg-primary font-display text-sm font-bold text-white shadow-sm"
            >
              A
            </span>
            <span className="hidden font-display text-lg font-semibold text-ink sm:inline">
              AgileCampus
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className="whitespace-nowrap rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              工作台
            </Link>
            <Link
              href="/projects"
              className="whitespace-nowrap rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              项目
            </Link>
            <Link
              href="/teams"
              className="whitespace-nowrap rounded-field px-2.5 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              团队
            </Link>
          </nav>
        </div>
        <details className="relative shrink-0">
          <summary aria-label="账户菜单" className="flex cursor-pointer list-none items-center gap-2 whitespace-nowrap rounded-field px-2 py-1.5 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary [&::-webkit-details-marker]:hidden">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs font-semibold text-white">
              {session.user.name?.slice(0, 1) ?? "?"}
            </span>
            <span className="hidden max-w-40 truncate sm:inline">{session.user.name}</span>
          </summary>
          <div className="absolute right-0 z-30 mt-1 w-40 space-y-1 rounded-field border border-line bg-surface p-1 shadow-pop">
            <Link
              href="/settings"
              className="block rounded px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              设置
            </Link>
            <Link
              href="/settings/tokens"
              className="block rounded px-3 py-2 text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary"
            >
              个人令牌
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button className="w-full rounded px-3 py-2 text-left text-sm text-ink-soft transition-colors hover:bg-primary-soft hover:text-primary">
                退出
              </button>
            </form>
          </div>
        </details>
      </header>
      <div className="mx-auto max-w-5xl p-6">{children}</div>
    </div>
  );
}
