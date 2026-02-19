import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { isMapMarkerType, isValidMarkerColor, normalizeMarkerColor } from "@/lib/map-markers";
import { updateState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateMarkerPayload = {
  type?: string;
  name?: string;
  color?: string;
  lat?: number;
  lng?: number;
};

export async function POST(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const gameCode = game.gameCode;
  if (!requestIsAdmin(request, gameCode)) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as CreateMarkerPayload;
  const markerTypeInput = payload.type;
  const markerType =
    typeof markerTypeInput === "string" && isMapMarkerType(markerTypeInput) ? markerTypeInput : undefined;
  const markerName = payload.name?.trim();
  const markerColor = normalizeMarkerColor(payload.color ?? "");

  if (markerTypeInput && !markerType) {
    return NextResponse.json({ error: "Invalid marker type." }, { status: 400 });
  }

  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
    return NextResponse.json({ error: "Marker latitude/longitude must be valid numbers." }, { status: 400 });
  }

  if (!markerName) {
    return NextResponse.json({ error: "Marker name is required." }, { status: 400 });
  }

  if (!payload.color || !isValidMarkerColor(payload.color)) {
    return NextResponse.json({ error: "Marker color must be a hex color like #1f5ecf." }, { status: 400 });
  }

  try {
    const state = await updateState(gameCode, (current) => ({
      ...current,
      mapMarkers: [
        ...(current.mapMarkers ?? []),
        {
          id: crypto.randomUUID(),
          type: markerType,
          name: markerName,
          color: markerColor ?? "#5f676c",
          lat: Number(payload.lat),
          lng: Number(payload.lng),
          createdAt: new Date().toISOString()
        }
      ]
    }));

    broadcastState({ gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create marker" },
      { status: 400 }
    );
  }
}
