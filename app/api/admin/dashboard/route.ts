import { NextRequest, NextResponse } from "next/server";
import { requestIsGlobalAdmin } from "@/lib/admin-auth";
import { getAdminDashboardSummary } from "@/lib/admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  try {
    const summary = await getAdminDashboardSummary();
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load dashboard summary." },
      { status: 400 }
    );
  }
}
