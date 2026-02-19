import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { isValidMarkerColor, normalizeMarkerColor } from "@/lib/map-markers";
import { updateState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateShapePayload = {
  label?: string;
  color?: string;
  opacity?: number;
  points?: Array<{ lat?: number; lng?: number }>;
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

  const payload = (await request.json().catch(() => ({}))) as CreateShapePayload;
  const label = payload.label?.trim();
  const color = normalizeMarkerColor(payload.color ?? "");
  const opacity = payload.opacity;
  const points = payload.points ?? [];

  if (!label) {
    return NextResponse.json({ error: "Shape label is required." }, { status: 400 });
  }

  if (!payload.color || !isValidMarkerColor(payload.color)) {
    return NextResponse.json({ error: "Shape color must be a hex color like #2ca34a." }, { status: 400 });
  }

  if (typeof opacity !== "number" || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
    return NextResponse.json({ error: "Shape transparency must be between 0 and 1." }, { status: 400 });
  }

  if (points.length < 3) {
    return NextResponse.json({ error: "Shape requires at least 3 points." }, { status: 400 });
  }

  const normalizedPoints = points.map((point) => ({
    lat: Number(point.lat),
    lng: Number(point.lng)
  }));

  if (normalizedPoints.some((point) => !Number.isFinite(point.lat) || !Number.isFinite(point.lng))) {
    return NextResponse.json({ error: "Shape points must be valid coordinates." }, { status: 400 });
  }

  try {
    const state = await updateState(gameCode, (current) => ({
      ...current,
      mapShapes: [
        ...(current.mapShapes ?? []),
        {
          id: crypto.randomUUID(),
          label,
          color: color ?? "#5f676c",
          opacity,
          points: normalizedPoints,
          createdAt: new Date().toISOString()
        }
      ]
    }));

    broadcastState({ gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create shape" },
      { status: 400 }
    );
  }
}
