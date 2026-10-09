import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST() {
  const s = await auth();
  if (!s?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  await markAllNotificationsRead(s.user.id);
  return NextResponse.json({ ok: true });
}
