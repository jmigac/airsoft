import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { isValidTeam, toNicknameLookupKey } from "@/lib/player-utils";
import { updateState } from "@/lib/store";
import { Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SwitchTeamPayload = {
  nickname?: string;
  team?: Team;
};

export async function PATCH(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  if (!requestIsAdmin(request, game.gameCode)) {
    return NextResponse.json({ error: "Admin privileges required" }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as SwitchTeamPayload;
  const nicknameKey = toNicknameLookupKey(payload.nickname ?? "");
  const nextTeam = payload.team;

  if (!nicknameKey) {
    return NextResponse.json({ error: "Nickname is required." }, { status: 400 });
  }

  if (!nextTeam || !isValidTeam(nextTeam)) {
    return NextResponse.json({ error: "Valid team is required." }, { status: 400 });
  }

  try {
    const state = await updateState(game.gameCode, (current) => {
      const players = current.players ?? [];
      const index = players.findIndex((entry) => toNicknameLookupKey(entry.nickname) === nicknameKey);
      if (index < 0) {
        throw new Error("Player not found.");
      }

      const updated = [...players];
      updated[index] = {
        ...updated[index],
        team: nextTeam,
        lastSeenAt: new Date().toISOString()
      };

      return {
        ...current,
        players: updated
      };
    });

    broadcastState({ gameCode: game.gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not switch player team." },
      { status: 400 }
    );
  }
}
