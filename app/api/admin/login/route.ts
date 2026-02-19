import { NextRequest, NextResponse } from "next/server";
import { normalizeGameCode } from "@/lib/game-code";
import { setAdminCookie, validateAdminPassword } from "@/lib/admin-auth";
import { gameExists } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as { password?: string; gameCode?: string };
  const gameCode = normalizeGameCode(payload.gameCode ?? request.nextUrl.searchParams.get("game"));

  if (!gameCode) {
    return NextResponse.json({ error: "Valid game code is required." }, { status: 400 });
  }

  const exists = await gameExists(gameCode);
  if (!exists) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }

  if (!payload.password || !validateAdminPassword(payload.password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  setAdminCookie(response, gameCode);
  return response;
}
