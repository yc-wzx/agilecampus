import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listNotifications } from "@/lib/notifications";

export async function GET() {
  const s = await auth();
  if (!s?.user?.id) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ items: await listNotifications(s.user.id) });
}
