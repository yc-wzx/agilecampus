import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";

/**
 * 成果段的访问边界（列表 / 新建 / 详情共用）。
 *
 * 为什么放在 layout：本段有 loading.tsx 与 error.tsx，页面数据在 Suspense 边界内，
 * 页面自己再调 notFound() 时外壳已经以 200 发出，会退化成“软 404”。
 * 在 layout 里先判定成员资格，未通过时在流式开始前结束，HTTP 状态保持 404。
 *
 * 注意：更细的对象级隐私（别人未提交的草稿）仍由成果服务在页面内判定，
 * 结果同样是 404 页面，但那种情况下状态码可能已是 200——服务端绝不返回他人草稿正文。
 */
export default async function DeliverablesLayout({
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
