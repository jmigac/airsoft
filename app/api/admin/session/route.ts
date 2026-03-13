import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  return NextResponse.json({
    admin: Boolean(session),
    session: session
      ? {
          email: session.email,
          role: session.role
        }
      : null
  });
}
