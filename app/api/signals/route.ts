import { NextRequest, NextResponse } from "next/server";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { isMapSignalType, MAP_SIGNAL_DURATION_MS } from "@/lib/map-signals";
import { TEAMS, Team } from "@/lib/types";
import { updateState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateSignalPayload = {
  team?: Team;
  type?: string;
  lat?: number;
  lng?: number;
};

export async function POST(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const payload = (await request.json().catch(() => ({}))) as CreateSignalPayload;
  const team = payload.team;
  const signalType = typeof payload.type === "string" ? payload.type : "";

  if (!team || !TEAMS.includes(team)) {
    return NextResponse.json({ error: "Invalid team." }, { status: 400 });
  }

  if (!isMapSignalType(signalType)) {
    return NextResponse.json({ error: "Invalid signal type." }, { status: 400 });
  }

  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
    return NextResponse.json({ error: "Signal coordinates must be valid numbers." }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + MAP_SIGNAL_DURATION_MS).toISOString();

  try {
    const state = await updateState(game.gameCode, (current) => ({
      ...current,
      mapSignals: [
        ...((current.mapSignals ?? []).filter((signal) => Date.parse(signal.expiresAt) > Date.now())),
        {
          id: crypto.randomUUID(),
          type: signalType,
          team,
          lat: Number(payload.lat),
          lng: Number(payload.lng),
          createdAt,
          expiresAt
        }
      ]
    }));

    broadcastState({ gameCode: game.gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not place signal." },
      { status: 400 }
    );
  }
}
