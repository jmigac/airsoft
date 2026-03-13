import { NextRequest, NextResponse } from "next/server";
import { requestIsGlobalAdmin } from "@/lib/admin-auth";
import { listAdminAudit } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "40");

  try {
    const items = await listAdminAudit(Number.isFinite(limit) ? Math.min(100, Math.max(1, limit)) : 40);
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load audit log." },
      { status: 400 }
    );
  }
}
