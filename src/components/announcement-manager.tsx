import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { AnnouncementEditor } from "./announcements/editor";
export async function AnnouncementManager({
  projectId,
}: {
  projectId: string;
}) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const access = await getProjectForUser(session.user.id, projectId);
  return access && access.role !== "student" ? (
    <AnnouncementEditor projectId={projectId} />
  ) : null;
}
