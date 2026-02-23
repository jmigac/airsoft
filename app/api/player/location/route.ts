import { NextRequest, NextResponse } from "next/server";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { getPlayerSessionId } from "@/lib/player-session";
import { updateState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LocationPayload = {
  lat?: number;
  lng?: number;
  accuracy?: number;
};

export async function PATCH(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const sessionId = getPlayerSessionId(request);
  if (!sessionId) {
    return NextResponse.json({ error: "Join a team first." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as LocationPayload;
  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
    return NextResponse.json({ error: "Latitude and longitude are required." }, { status: 400 });
  }

  const accuracy =
    typeof payload.accuracy === "number" && Number.isFinite(payload.accuracy) ? payload.accuracy : undefined;
  const now = new Date().toISOString();

  try {
    const state = await updateState(game.gameCode, (current) => {
      const players = current.players ?? [];
      const exists = players.some((entry) => entry.sessionId === sessionId);
      if (!exists) {
        throw new Error("Join a team before sharing location.");
      }

      return {
        ...current,
        players: players.map((entry) =>
          entry.sessionId === sessionId
            ? {
                ...entry,
                lastSeenAt: now,
                location: {
                  lat: Number(payload.lat),
                  lng: Number(payload.lng),
                  accuracy,
                  updatedAt: now
                }
              }
            : entry
        )
      };
    });

    broadcastState({ gameCode: game.gameCode, type: "sync", state });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update location." },
      { status: 400 }
    );
  }
}
