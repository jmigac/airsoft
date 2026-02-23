import { NextRequest, NextResponse } from "next/server";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { getPlayerSessionId } from "@/lib/player-session";
import { readState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const sessionId = getPlayerSessionId(request);
  if (!sessionId) {
    return NextResponse.json({ player: null });
  }

  try {
    const state = await readState(game.gameCode);
    const player = (state.players ?? []).find((entry) => entry.sessionId === sessionId) ?? null;
    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load player profile." },
      { status: 400 }
    );
  }
}
