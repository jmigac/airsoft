import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { isValidCETDateTime, normalizeCETDateTimeInput } from "@/lib/mission-time";
import { isValidQuestPayload } from "@/lib/payload";
import { updateState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateMissionPayload = {
  name?: string;
  qrCode?: string;
  mapCenter?: { lat?: number; lng?: number };
  timeWindowCET?: { startsAtCET?: string; endsAtCET?: string };
  locations?: Array<{ lat?: number; lng?: number; radius?: number }>;
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

  const payload = (await request.json()) as CreateMissionPayload;
  const name = payload.name?.trim();
  const qrCode = payload.qrCode?.trim();
  const mapCenter = payload.mapCenter;
  const startsAtCET = normalizeCETDateTimeInput(payload.timeWindowCET?.startsAtCET ?? "");
  const endsAtCET = normalizeCETDateTimeInput(payload.timeWindowCET?.endsAtCET ?? "");
  const hasTimeWindow = startsAtCET.length > 0 || endsAtCET.length > 0;
  const locations = payload.locations ?? [];

  if (!name || !qrCode) {
    return NextResponse.json({ error: "Mission name and payload are required." }, { status: 400 });
  }

  if (!isValidQuestPayload(qrCode)) {
    return NextResponse.json(
      { error: "Quest payload must be exactly 6 digits." },
      { status: 400 }
    );
  }

  if (locations.length === 0) {
    return NextResponse.json({ error: "At least one location circle is required" }, { status: 400 });
  }

  if (
    locations.some(
      (location) =>
        !Number.isFinite(location.lat) || !Number.isFinite(location.lng) || !Number.isFinite(location.radius)
    )
  ) {
    return NextResponse.json({ error: "Location values must be numbers" }, { status: 400 });
  }

  if (
    mapCenter &&
    (!Number.isFinite(mapCenter.lat) || !Number.isFinite(mapCenter.lng))
  ) {
    return NextResponse.json({ error: "Map center latitude/longitude must be valid numbers." }, { status: 400 });
  }

  if (hasTimeWindow) {
    if (!startsAtCET || !endsAtCET) {
      return NextResponse.json(
        { error: "For time-critical missions, both CET start and end are required." },
        { status: 400 }
      );
    }

    if (!isValidCETDateTime(startsAtCET) || !isValidCETDateTime(endsAtCET)) {
      return NextResponse.json(
        { error: "CET start/end must use a valid date and time (YYYY-MM-DDTHH:mm)." },
        { status: 400 }
      );
    }

    if (startsAtCET >= endsAtCET) {
      return NextResponse.json(
        { error: "CET start time must be before CET end time." },
        { status: 400 }
      );
    }
  }

  try {
    const state = await updateState(gameCode, (current) => {
      if (current.missions.some((mission) => mission.qrCode === qrCode)) {
        throw new Error("A mission with this payload already exists.");
      }

      return {
        ...current,
        missions: [
          ...current.missions,
          {
            id: crypto.randomUUID(),
            name,
            qrCode,
            mapCenter: mapCenter
              ? {
                  lat: Number(mapCenter.lat),
                  lng: Number(mapCenter.lng)
                }
              : undefined,
            timeWindowCET: hasTimeWindow
              ? {
                  startsAtCET,
                  endsAtCET
                }
              : undefined,
            createdAt: new Date().toISOString(),
            locations: locations.map((location) => ({
              id: crypto.randomUUID(),
              lat: Number(location.lat),
              lng: Number(location.lng),
              radius: Number(location.radius)
            }))
          }
        ]
      };
    });

    broadcastState({ gameCode, type: "mission_created", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create mission" },
      { status: 400 }
    );
  }
}
