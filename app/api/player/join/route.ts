import { NextRequest, NextResponse } from "next/server";
import { broadcastState } from "@/lib/events";
import { requireGameCodeFromRequest } from "@/lib/game-request";
import { ensurePlayerSessionId } from "@/lib/player-session";
import { isValidNickname, isValidTeam, normalizeNickname, toNicknameLookupKey } from "@/lib/player-utils";
import { filterStateForViewer } from "@/lib/state-visibility";
import { updateState } from "@/lib/store";
import { Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JoinPayload = {
  nickname?: string;
  team?: Team;
};

export async function POST(request: NextRequest) {
  const game = requireGameCodeFromRequest(request);
  if (!game.ok) {
    return game.response;
  }

  const payload = (await request.json().catch(() => ({}))) as JoinPayload;
  const nickname = normalizeNickname(payload.nickname ?? "");
  const team = payload.team;

  if (!isValidNickname(nickname)) {
    return NextResponse.json({ error: "Nickname is required (minimum 2 characters)." }, { status: 400 });
  }

  if (!team || !isValidTeam(team)) {
    return NextResponse.json({ error: "Valid team is required." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  const sessionId = ensurePlayerSessionId(request, response);
  const nicknameKey = toNicknameLookupKey(nickname);

  try {
    let playerId = "";
    const state = await updateState(game.gameCode, (current) => {
      const players = current.players ?? [];
      const bySession = players.find((entry) => entry.sessionId === sessionId);

      if (bySession) {
        if (bySession.team !== team || toNicknameLookupKey(bySession.nickname) !== nicknameKey) {
          throw new Error("Team and nickname are locked for this device. Ask admin to switch team.");
        }

        playerId = bySession.id;
        const now = new Date().toISOString();
        return {
          ...current,
          players: players.map((entry) =>
            entry.sessionId === sessionId
              ? {
                  ...entry,
                  lastSeenAt: now
                }
              : entry
          )
        };
      }

      const nicknameTaken = players.some((entry) => toNicknameLookupKey(entry.nickname) === nicknameKey);
      if (nicknameTaken) {
        throw new Error("Nickname is already used in this game.");
      }

      const now = new Date().toISOString();
      const createdId = crypto.randomUUID();
      playerId = createdId;

      return {
        ...current,
        players: [
          ...players,
          {
            id: createdId,
            sessionId,
            nickname,
            team,
            joinedAt: now,
            lastSeenAt: now
          }
        ]
      };
    });

    const player = (state.players ?? []).find((entry) => entry.id === playerId) ?? null;
    const visibleState = filterStateForViewer(state, {
      isAdmin: false,
      sessionId,
      team: player?.team ?? null
    });
    broadcastState({ gameCode: game.gameCode, type: "sync", state });
    return NextResponse.json({ ok: true, player, state: visibleState }, { headers: response.headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not join game." },
      { status: 400, headers: response.headers }
    );
  }
}
