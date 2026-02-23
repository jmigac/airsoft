import { NextRequest } from "next/server";
import { requestIsAdmin } from "./admin-auth";
import { getPlayerSessionId } from "./player-session";
import { GameState, Team } from "./types";

export type StateViewer = {
  isAdmin: boolean;
  sessionId: string | null;
  team: Team | null;
};

export function resolveViewerTeamForSession(state: GameState, sessionId: string | null) {
  if (!sessionId) {
    return null;
  }

  return (state.players ?? []).find((entry) => entry.sessionId === sessionId)?.team ?? null;
}

export function resolveStateViewerFromRequest(request: NextRequest, gameCode: string, state: GameState): StateViewer {
  const isAdmin = requestIsAdmin(request, gameCode);
  const sessionId = getPlayerSessionId(request) ?? null;
  const team = isAdmin ? null : resolveViewerTeamForSession(state, sessionId);

  return {
    isAdmin,
    sessionId,
    team
  };
}

export function filterStateForTeam(state: GameState, team: Team | null): GameState {
  return {
    ...state,
    players: team ? (state.players ?? []).filter((player) => player.team === team) : [],
    mapSignals: team ? (state.mapSignals ?? []).filter((signal) => signal.team === team) : []
  };
}

export function filterStateForViewer(state: GameState, viewer: StateViewer): GameState {
  if (viewer.isAdmin) {
    return state;
  }

  return filterStateForTeam(state, viewer.team);
}
