import { NextRequest, NextResponse } from "next/server";
import { requestIsGlobalAdmin } from "@/lib/admin-auth";
import { listAdminPlayers } from "@/lib/admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "10");
  const query = request.nextUrl.searchParams.get("query") ?? undefined;
  const gameCode = request.nextUrl.searchParams.get("gameCode") ?? undefined;

  try {
    const result = await listAdminPlayers({
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 10,
      query,
      gameCode
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load players." },
      { status: 400 }
    );
  }
}
