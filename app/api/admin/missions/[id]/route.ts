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
  if (!(await requestIsAdmin(request, gameCode))) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 401 });
  }

  const params = await context.params;
  const missionId = params.id;

  try {
    const state = await updateState(gameCode, (current) => {
      const exists = current.missions.some((mission) => mission.id === missionId);
      if (!exists) {
        throw new Error("Mission not found");
      }

      return {
        ...current,
        missions: current.missions.filter((mission) => mission.id !== missionId),
        completions: current.completions.filter((completion) => completion.missionId !== missionId),
        missionIntelUploads: (current.missionIntelUploads ?? []).filter((upload) => upload.missionId !== missionId)
      };
    });

    broadcastState({ gameCode, type: "mission_deleted", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not delete mission" },
      { status: 400 }
    );
  }
}
