import { NextResponse } from "next/server";
import { normalizeGameCode } from "@/lib/game-code";
import { gameExists } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> }
) {
  const params = await context.params;
  const gameCode = normalizeGameCode(params.code);
  if (!gameCode) {
    return NextResponse.json({ error: "Invalid game code format." }, { status: 400 });
  }

  const exists = await gameExists(gameCode);
  if (!exists) {
    return NextResponse.json({ error: "Game not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, gameCode });
}
