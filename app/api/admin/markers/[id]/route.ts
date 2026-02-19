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
  const markerId = params.id;

  try {
    const state = await updateState(gameCode, (current) => {
      const exists = (current.mapMarkers ?? []).some((marker) => marker.id === markerId);
      if (!exists) {
        throw new Error("Marker not found");
      }

      return {
        ...current,
        mapMarkers: (current.mapMarkers ?? []).filter((marker) => marker.id !== markerId)
      };
    });

    broadcastState({ gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete marker" },
      { status: 400 }
    );
  }
}
