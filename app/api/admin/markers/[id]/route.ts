import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { updateAdminMarkerRecord } from "@/lib/admin-store";
import { isMapMarkerType, isValidMarkerColor } from "@/lib/map-markers";
import { readState, updateState } from "@/lib/store";
import { Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateMarkerPayload = {
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

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const gameCode = game.gameCode;
  if (!(await requestIsAdmin(request, gameCode))) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as UpdateMarkerPayload;
  const params = await context.params;
  const markerType =
    typeof payload.type === "string" && isMapMarkerType(payload.type) ? payload.type : undefined;

  if (!payload.name?.trim()) {
    return NextResponse.json({ error: "Marker name is required." }, { status: 400 });
  }

  if (!payload.color || !isValidMarkerColor(payload.color)) {
    return NextResponse.json({ error: "Marker color must be a hex color like #1f5ecf." }, { status: 400 });
  }

  if (!Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) {
    return NextResponse.json({ error: "Marker latitude/longitude must be valid numbers." }, { status: 400 });
  }

  if (payload.type && !markerType) {
    return NextResponse.json({ error: "Invalid marker type." }, { status: 400 });
  }

  if (
    payload.visibility === "selected_teams" &&
    (!Array.isArray(payload.visibleTeams) || payload.visibleTeams.length === 0)
  ) {
    return NextResponse.json({ error: "Select at least one team for team-only visibility." }, { status: 400 });
  }

  try {
    const marker = await updateAdminMarkerRecord(gameCode, params.id, {
      type: markerType,
      name: payload.name,
      description: payload.description,
      icon: payload.icon,
      color: payload.color,
      lat: Number(payload.lat),
      lng: Number(payload.lng),
      visibility: payload.visibility ?? "all",
      visibleTeams: payload.visibility === "selected_teams" ? payload.visibleTeams ?? [] : undefined
    });
    const state = await readState(gameCode);

    broadcastState({ gameCode, type: "sync", state });
    await recordAdminAction({
      action: "marker.updated",
      entityType: "marker",
      entityId: params.id,
      gameCode,
      message: `Updated marker ${marker?.name ?? params.id}.`,
      metadata: { visibility: payload.visibility ?? "all" }
    });
    return NextResponse.json({ ok: true, marker, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update marker." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const gameCode = game.gameCode;
  if (!(await requestIsAdmin(request, gameCode))) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 401 });
  }

  const params = await context.params;
  const markerId = params.id;

  try {
    let removedMarkerName = markerId;
    const state = await updateState(gameCode, (current) => {
      const existing = (current.mapMarkers ?? []).find((marker) => marker.id === markerId);
      if (!existing) {
        throw new Error("Marker not found");
      }
      removedMarkerName = existing.name;

      return {
        ...current,
        mapMarkers: (current.mapMarkers ?? []).filter((marker) => marker.id !== markerId)
      };
    });

    broadcastState({ gameCode, type: "sync", state });
    await recordAdminAction({
      action: "marker.deleted",
      entityType: "marker",
      entityId: markerId,
      gameCode,
      message: `Deleted marker ${removedMarkerName}.`,
      metadata: {}
    });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete marker" },
      { status: 400 }
    );
  }
}
