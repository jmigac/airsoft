import { NextRequest, NextResponse } from "next/server";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { readState } from "@/lib/store";
import { filterStateForViewer, resolveStateViewerFromRequest } from "@/lib/state-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  try {
    const state = await readState(game.gameCode);
    const viewer = await resolveStateViewerFromRequest(request, game.gameCode, state);
    return NextResponse.json(filterStateForViewer(state, viewer));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load game state.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
