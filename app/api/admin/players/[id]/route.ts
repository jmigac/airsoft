import { NextRequest, NextResponse } from "next/server";
import { requestIsAdmin } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { updateAdminPlayerRecord } from "@/lib/admin-store";
import { readState, updateState } from "@/lib/store";
import { Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdatePlayerPayload = {
  nickname?: string;
  team?: Team;
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

  const params = await context.params;
  const payload = (await request.json().catch(() => ({}))) as UpdatePlayerPayload;

  if (!payload.nickname?.trim() || !payload.team) {
    return NextResponse.json({ error: "Nickname and team are required." }, { status: 400 });
  }

  try {
    const player = await updateAdminPlayerRecord(gameCode, params.id, {
      nickname: payload.nickname,
      team: payload.team
    });
    const state = await readState(gameCode);
    broadcastState({ gameCode, type: "sync", state });
    await recordAdminAction({
      action: "player.updated",
      entityType: "player",
      entityId: params.id,
      gameCode,
      message: `Updated player ${player?.nickname ?? params.id}.`,
      metadata: { team: payload.team }
    });
    return NextResponse.json({ ok: true, player, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update player." },
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
  const playerId = params.id;

  try {
    let removedPlayerNickname = params.id;
    const state = await updateState(gameCode, (current) => {
      const players = current.players ?? [];
      const existing = players.find((player) => player.id === playerId);
      if (!existing) {
        throw new Error("Player not found.");
      }
      removedPlayerNickname = existing.nickname;

      return {
        ...current,
        players: players.filter((player) => player.id !== playerId)
      };
    });

    broadcastState({ gameCode, type: "sync", state });
    await recordAdminAction({
      action: "player.removed",
      entityType: "player",
      entityId: playerId,
      gameCode,
      message: `Removed player ${removedPlayerNickname} from game.`,
      metadata: {}
    });
    return NextResponse.json({ ok: true, state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not remove player." },
      { status: 400 }
    );
  }
}
