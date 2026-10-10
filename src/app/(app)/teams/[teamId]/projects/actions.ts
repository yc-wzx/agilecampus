"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createProject } from "@/lib/project";
import { AppError, ForbiddenError } from "@/lib/errors";

const schema = z.object({
  teamId: z.uuid(),
  name: z.string().trim().min(1, "请填写项目名称"),
  description: z.string().trim().optional(),
  startDate: z.iso.date("日期格式不正确").optional(),
  endDate: z.iso.date("日期格式不正确").optional(),
  templateId: z
    .enum(["blank", "course", "research", "competition"])
    .default("blank"),
  requestId: z.uuid(),
});

export type FormState = { error: string } | null;

export async function createProjectAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await auth();
  if (!session?.user) return { error: "请先登录" };

  const raw = Object.fromEntries(formData);
  const parsed = schema.safeParse({
    ...raw,
    description: raw.description || undefined,
    startDate: raw.startDate || undefined,
    endDate: raw.endDate || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let projectId: string;
  try {
    const project = await createProject(session.user.id, parsed.data.teamId, {
      name: parsed.data.name,
      description: parsed.data.description,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      templateId: parsed.data.templateId,
      requestId: parsed.data.requestId,
    });
    projectId = project.id;
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: "仅团队管理员可创建项目" };
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/teams/${parsed.data.teamId}/projects`);
  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
