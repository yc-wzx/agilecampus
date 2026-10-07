import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";

/**
 * 证据段的访问边界。
 *
 * 与概览/成果段同理：本段有 loading.tsx，页面数据在 Suspense 边界内，
 * 页面自己再调 notFound() 时外壳已按 200 流出，会退化成软 404。
 * 在 layout 里先判定成员资格，未通过时在流式开始前结束，HTTP 状态保持 404。
 */
export default async function EvidenceLayout({
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

  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();

  return <>{children}</>;
}
