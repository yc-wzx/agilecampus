import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUnreadCount } from "@/lib/notifications";

export async function GET() {
  const s = await auth();
  if (!s?.user?.id) return NextResponse.json({ unread: 0 }, { status: 401 });
  return NextResponse.json({ unread: await getUnreadCount(s.user.id) });
}
