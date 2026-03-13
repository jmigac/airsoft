import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { isMapMarkerType, isValidMarkerColor, normalizeMarkerColor } from "@/lib/map-markers";
import { updateState } from "@/lib/store";
import { Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateMarkerPayload = {
  type?: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  lat?: number;
  lng?: number;
  visibility?: "all" | "admins" | "selected_teams";
  visibleTeams?: Team[];
};

export async function POST(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const gameCode = game.gameCode;
  if (!(await requestIsAdmin(request, gameCode))) {
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

  if (
    payload.visibility === "selected_teams" &&
    (!Array.isArray(payload.visibleTeams) || payload.visibleTeams.length === 0)
  ) {
    return NextResponse.json({ error: "Select at least one team for team-only visibility." }, { status: 400 });
  }

  try {
    let createdMarkerId = "";
    const state = await updateState(gameCode, (current) => ({
      ...current,
      mapMarkers: [
        ...(current.mapMarkers ?? []),
        {
          id: (() => {
            createdMarkerId = crypto.randomUUID();
            return createdMarkerId;
          })(),
          type: markerType,
          name: markerName,
          description: payload.description?.trim() || undefined,
          icon: payload.icon?.trim() || undefined,
          color: markerColor ?? "#5f676c",
          lat: Number(payload.lat),
          lng: Number(payload.lng),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          visibility: payload.visibility ?? "all",
          visibleTeams: payload.visibility === "selected_teams" ? payload.visibleTeams ?? [] : undefined
        }
      ]
    }));

    broadcastState({ gameCode, type: "sync", state });
    await recordAdminAction({
      action: "marker.created",
      entityType: "marker",
      entityId: createdMarkerId,
      gameCode,
      message: `Created marker ${markerName}.`,
      metadata: { type: markerType ?? "custom", visibility: payload.visibility ?? "all" }
    });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create marker" },
      { status: 400 }
    );
  }
}
