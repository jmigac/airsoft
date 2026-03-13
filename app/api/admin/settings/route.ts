import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { updateState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SettingsPayload = {
  defaultMapCenter?: { lat?: number; lng?: number } | null;
};

export async function PATCH(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const gameCode = game.gameCode;
  if (!(await requestIsAdmin(request, gameCode))) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as SettingsPayload;
  const center = payload.defaultMapCenter;

  if (center !== null && center !== undefined) {
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
      return NextResponse.json(
        { error: "Default map center latitude/longitude must be valid numbers." },
        { status: 400 }
      );
    }
  }

  try {
    const state = await updateState(gameCode, (current) => ({
      ...current,
      defaultMapCenter:
        center === null || center === undefined
          ? undefined
          : {
              lat: Number(center.lat),
              lng: Number(center.lng)
            }
    }));

    broadcastState({ gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update settings" },
      { status: 400 }
    );
  }
}
