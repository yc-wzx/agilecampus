import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";

/**
 * 项目概览段的访问边界。
 *
 * 为什么放在 layout：本段有 loading.tsx，页面数据被包在 Suspense 边界里，
 * 等页面再调 notFound() 时响应外壳已经以 200 流式发出，只能变成“软 404”。
 * 在 layout 里先判定成员资格，未通过时在流式开始前就结束，HTTP 状态仍是 404，
 * 同时保留页面级的加载骨架。
 */
export default async function OverviewLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();

  // 非团队成员一律 404，不泄露项目是否存在
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  return <>{children}</>;
}
