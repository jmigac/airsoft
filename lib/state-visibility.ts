import { NextRequest } from "next/server";
import { requestIsAdmin } from "./admin-auth";
import { getPlayerSessionId } from "./player-session";
import { GameState, MapMarker, Team } from "./types";

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

export async function resolveStateViewerFromRequest(
  request: NextRequest,
  gameCode: string,
  state: GameState
): Promise<StateViewer> {
  const isAdmin = await requestIsAdmin(request, gameCode);
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
    missionIntelUploads: [],
    players: team ? (state.players ?? []).filter((player) => player.team === team) : [],
    mapSignals: team ? (state.mapSignals ?? []).filter((signal) => signal.team === team) : [],
    mapMarkers: (state.mapMarkers ?? []).filter((marker) => markerVisibleToTeam(marker, team))
  };
}

function markerVisibleToTeam(marker: MapMarker, team: Team | null) {
  if (marker.visibility === "admins") {
    return false;
  }

  if (marker.visibility === "selected_teams") {
    return Boolean(team && (marker.visibleTeams ?? []).includes(team));
  }

  return true;
}

export function filterStateForViewer(state: GameState, viewer: StateViewer): GameState {
  if (viewer.isAdmin) {
    return state;
  }

  return filterStateForTeam(state, viewer.team);
}
