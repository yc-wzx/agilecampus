import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { FeishuCard } from "./feishu-card";
import { getMyNotificationChannels } from "@/lib/notification";

function fmt(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ feishu?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [row] = await db
    .select({
      feishuName: users.feishuName,
      feishuBoundAt: users.feishuBoundAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id));
  const { feishu } = await searchParams;
  const channels = await getMyNotificationChannels(session.user.id);

  return (
    <main className="mx-auto max-w-2xl space-y-8 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">设置</h1>
        <p className="text-sm text-ink-soft">
          账号与通知设置。个人访问令牌见「设置 → 令牌」。
        </p>
      </header>

      <FeishuCard
        boundName={row?.feishuName ?? null}
        boundAtLabel={fmt(row?.feishuBoundAt ?? null)}
        notice={feishu ?? null}
      />
      <section className="ac-card space-y-2 p-4">
        <h2 className="font-semibold">通知渠道</h2>
        <p className="text-sm">站内通知已启用</p>
        <p className="text-sm">
          飞书：
          {
            {
              unbound: "尚未绑定",
              unconfigured: "服务器尚未配置",
              configured: "配置就绪（不代表已验证送达）",
              failed: "最近发送失败或结果待核实，请查看站内通知",
            }[channels.externalStatus]
          }
        </p>
        <p className="text-xs text-ink-soft">
          明确拒绝的发送会自动重试；超时、断网或进程中断导致的未知结果保留记录，由负责人核实。
        </p>
      </section>
    </main>
  );
}
