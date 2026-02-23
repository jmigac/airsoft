import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { updateState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const gameCode = game.gameCode;
  if (!requestIsAdmin(request, gameCode)) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 401 });
  }

  const params = await context.params;
  const playerId = params.id;

  try {
    const state = await updateState(gameCode, (current) => {
      const players = current.players ?? [];
      const exists = players.some((player) => player.id === playerId);
      if (!exists) {
        throw new Error("Player not found.");
      }

      return {
        ...current,
        players: players.filter((player) => player.id !== playerId)
      };
    });

    broadcastState({ gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove player." },
      { status: 400 }
    );
  }
}
