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
  const shapeId = params.id;

  try {
    const state = await updateState(gameCode, (current) => {
      const exists = (current.mapShapes ?? []).some((shape) => shape.id === shapeId);
      if (!exists) {
        throw new Error("Shape not found");
      }

      return {
        ...current,
        mapShapes: (current.mapShapes ?? []).filter((shape) => shape.id !== shapeId)
      };
    });

    broadcastState({ gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete shape" },
      { status: 400 }
    );
  }
}
