import "server-only";
import { AdminDashboardSummary, AdminGameDetail, AdminGameMutationInput, AdminGameSummary, AdminPlayerRecord, AdminPlayersResponse } from "./admin-types";
import { deleteRows, fetchRows, fetchRowsWithCount, patchRows } from "./admin-db";
import { gameExists, readState, updateState } from "./store";
import { GameStatus, MapMarker, Team } from "./types";
import { normalizeGameCode } from "./game-code";
import { normalizeMarkerColor } from "./map-markers";
import { toNicknameLookupKey } from "./player-utils";

const ACTIVE_PLAYER_WINDOW_MS = 10 * 60 * 1000;

type GameRow = {
  code: string;
  name: string | null;
  description: string | null;
  status: string | null;
  map_reference: string | null;
  creation_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  default_map_center_lat: number | null;
  default_map_center_lng: number | null;
};

type PlayerRow = {
  id: string;
  game_code: string;
  nickname: string;
  team: Team;
  joined_at: string;
  last_seen_at: string;
  location_lat: number | null;
  location_lng: number | null;
  location_accuracy: number | null;
  location_updated_at: string | null;
};

type MarkerRow = {
  id: string;
  game_code: string;
};

function normalizeGameStatus(value: string | null | undefined): GameStatus {
  if (value === "draft" || value === "scheduled" || value === "paused" || value === "completed" || value === "archived") {
    return value;
  }

  return "active";
}

function buildGameSummary(row: GameRow, playerCounts: Map<string, number>, activePlayerCounts: Map<string, number>, markerCounts: Map<string, number>): AdminGameSummary {
  return {
    code: row.code,
    name: row.name?.trim() || `Game ${row.code}`,
    description: row.description?.trim() || "",
    status: normalizeGameStatus(row.status),
    mapReference: row.map_reference?.trim() || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    playerCount: playerCounts.get(row.code) ?? 0,
    markerCount: markerCounts.get(row.code) ?? 0,
    activePlayerCount: activePlayerCounts.get(row.code) ?? 0,
    defaultMapCenter:
      Number.isFinite(row.default_map_center_lat) && Number.isFinite(row.default_map_center_lng)
        ? { lat: Number(row.default_map_center_lat), lng: Number(row.default_map_center_lng) }
        : null,
    creationMetadata: row.creation_metadata ?? {}
  };
}

function buildInFilter(values: string[]) {
  return `in.(${values.join(",")})`;
}

function playerRowToRecord(row: PlayerRow, gameName: string): AdminPlayerRecord {
  const lastSeenMs = Date.parse(row.last_seen_at);
  const active = Number.isFinite(lastSeenMs) && lastSeenMs >= Date.now() - ACTIVE_PLAYER_WINDOW_MS;

  return {
    id: row.id,
    nickname: row.nickname,
    gameCode: row.game_code,
    gameName,
    team: row.team,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at,
    status: active ? "active" : "disconnected",
    location:
      Number.isFinite(row.location_lat) && Number.isFinite(row.location_lng) && row.location_updated_at
        ? {
            lat: Number(row.location_lat),
            lng: Number(row.location_lng),
            accuracy: typeof row.location_accuracy === "number" ? row.location_accuracy : undefined,
            updatedAt: row.location_updated_at
          }
        : undefined
  };
}

async function fetchGameCounts(gameCodes: string[]) {
  if (gameCodes.length === 0) {
    return {
      playerCounts: new Map<string, number>(),
      activePlayerCounts: new Map<string, number>(),
      markerCounts: new Map<string, number>()
    };
  }

  const activeSinceIso = new Date(Date.now() - ACTIVE_PLAYER_WINDOW_MS).toISOString();
  const [players, activePlayers, markers] = await Promise.all([
    fetchRows<PlayerRow>(
      "players",
      new URLSearchParams({
        select: "id,game_code,nickname,team,joined_at,last_seen_at,location_lat,location_lng,location_accuracy,location_updated_at",
        game_code: buildInFilter(gameCodes)
      })
    ),
    fetchRows<PlayerRow>(
      "players",
      new URLSearchParams({
        select: "id,game_code,nickname,team,joined_at,last_seen_at,location_lat,location_lng,location_accuracy,location_updated_at",
        game_code: buildInFilter(gameCodes),
        last_seen_at: `gte.${activeSinceIso}`
      })
    ),
    fetchRows<MarkerRow>(
      "map_markers",
      new URLSearchParams({
        select: "id,game_code",
        game_code: buildInFilter(gameCodes)
      })
    )
  ]);

  const playerCounts = new Map<string, number>();
  const activePlayerCounts = new Map<string, number>();
  const markerCounts = new Map<string, number>();

  for (const row of players) {
    playerCounts.set(row.game_code, (playerCounts.get(row.game_code) ?? 0) + 1);
  }

  for (const row of activePlayers) {
    activePlayerCounts.set(row.game_code, (activePlayerCounts.get(row.game_code) ?? 0) + 1);
  }

  for (const row of markers) {
    markerCounts.set(row.game_code, (markerCounts.get(row.game_code) ?? 0) + 1);
  }

  return { playerCounts, activePlayerCounts, markerCounts };
}

export async function getAdminDashboardSummary(): Promise<AdminDashboardSummary> {
  const activeSinceIso = new Date(Date.now() - ACTIVE_PLAYER_WINDOW_MS).toISOString();
  const [gamesResult, activeGamesResult, activePlayersResult, recentGamesResult] = await Promise.all([
    fetchRowsWithCount<GameRow>(
      "games",
      new URLSearchParams({
        select:
          "code,name,description,status,map_reference,creation_metadata,created_at,updated_at,default_map_center_lat,default_map_center_lng",
        order: "created_at.desc"
      }),
      { from: 0, to: 4 }
    ),
    fetchRowsWithCount<GameRow>(
      "games",
      new URLSearchParams({
        select:
          "code,name,description,status,map_reference,creation_metadata,created_at,updated_at,default_map_center_lat,default_map_center_lng",
        status: "eq.active"
      })
    ),
    fetchRowsWithCount<PlayerRow>(
      "players",
      new URLSearchParams({
        select: "id,game_code,nickname,team,joined_at,last_seen_at,location_lat,location_lng,location_accuracy,location_updated_at",
        last_seen_at: `gte.${activeSinceIso}`
      })
    ),
    fetchRows<GameRow>(
      "games",
      new URLSearchParams({
        select:
          "code,name,description,status,map_reference,creation_metadata,created_at,updated_at,default_map_center_lat,default_map_center_lng",
        order: "created_at.desc",
        limit: "5"
      })
    )
  ]);

  const counts = await fetchGameCounts(recentGamesResult.map((game) => game.code));

  return {
    totalGames: gamesResult.count,
    totalActivePlayers: activePlayersResult.count,
    activeGames: activeGamesResult.count,
    recentGames: recentGamesResult.map((row) =>
      buildGameSummary(row, counts.playerCounts, counts.activePlayerCounts, counts.markerCounts)
    )
  };
}

export async function listAdminGames(input: {
  page: number;
  pageSize: number;
  query?: string;
  status?: string;
  sort?: "created_at" | "name" | "status" | "player_count";
  direction?: "asc" | "desc";
}) {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(50, Math.max(1, input.pageSize));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const search = new URLSearchParams({
    select:
      "code,name,description,status,map_reference,creation_metadata,created_at,updated_at,default_map_center_lat,default_map_center_lng"
  });
  if (input.sort !== "player_count") {
    search.set("order", `${input.sort ?? "created_at"}.${input.direction ?? "desc"}`);
  }

  const query = input.query?.trim();
  if (query) {
    search.set("or", `(code.ilike.*${query}*,name.ilike.*${query}*)`);
  }

  const status = input.status?.trim();
  if (status) {
    search.set("status", `eq.${status}`);
  }

  if (input.sort === "player_count") {
    const result = await fetchRowsWithCount<GameRow>("games", search);
    const counts = await fetchGameCounts(result.rows.map((row) => row.code));
    const sorted = result.rows
      .map((row) => buildGameSummary(row, counts.playerCounts, counts.activePlayerCounts, counts.markerCounts))
      .sort((left, right) =>
        input.direction === "asc"
          ? left.playerCount - right.playerCount || left.name.localeCompare(right.name)
          : right.playerCount - left.playerCount || left.name.localeCompare(right.name)
      );

    return {
      items: sorted.slice(from, to + 1),
      total: result.count,
      page,
      pageSize
    };
  }

  const result = await fetchRowsWithCount<GameRow>("games", search, { from, to });
  const counts = await fetchGameCounts(result.rows.map((row) => row.code));

  return {
    items: result.rows.map((row) => buildGameSummary(row, counts.playerCounts, counts.activePlayerCounts, counts.markerCounts)),
    total: result.count,
    page,
    pageSize
  };
}

export async function getAdminGameDetail(gameCode: string): Promise<AdminGameDetail> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  const games = await fetchRows<GameRow>(
    "games",
    new URLSearchParams({
      select:
        "code,name,description,status,map_reference,creation_metadata,created_at,updated_at,default_map_center_lat,default_map_center_lng",
      code: `eq.${normalizedGameCode}`,
      limit: "1"
    })
  );
  const game = games[0];
  if (!game) {
    throw new Error("Game not found.");
  }

  const [state, playerRows] = await Promise.all([
    readState(normalizedGameCode),
    fetchRows<PlayerRow>(
      "players",
      new URLSearchParams({
        select: "id,game_code,nickname,team,joined_at,last_seen_at,location_lat,location_lng,location_accuracy,location_updated_at",
        game_code: `eq.${normalizedGameCode}`,
        order: "joined_at.asc"
      })
    )
  ]);

  const counts = await fetchGameCounts([normalizedGameCode]);
  const summary = buildGameSummary(game, counts.playerCounts, counts.activePlayerCounts, counts.markerCounts);

  return {
    game: summary,
    players: playerRows.map((row) => playerRowToRecord(row, summary.name)),
    markers: state.mapMarkers ?? [],
    missionsCount: state.missions.length,
    shapesCount: (state.mapShapes ?? []).length,
    completionsCount: state.completions.length,
    defaultMapCenter: summary.defaultMapCenter,
    state
  };
}

export async function updateAdminGameRecord(gameCode: string, input: AdminGameMutationInput) {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  const exists = await gameExists(normalizedGameCode);
  if (!exists) {
    throw new Error("Game not found.");
  }

  const rows = await patchRows<GameRow[]>(
    "games",
    new URLSearchParams({
      select:
        "code,name,description,status,map_reference,creation_metadata,created_at,updated_at,default_map_center_lat,default_map_center_lng",
      code: `eq.${normalizedGameCode}`
    }),
    {
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: input.status,
      map_reference: input.mapReference?.trim() || null,
      creation_metadata: input.creationMetadata ?? {}
    },
    { returning: "representation" }
  );

  if (rows.length !== 1) {
    throw new Error("Could not update game.");
  }

  const counts = await fetchGameCounts([normalizedGameCode]);
  return buildGameSummary(rows[0], counts.playerCounts, counts.activePlayerCounts, counts.markerCounts);
}

export async function deleteAdminGameRecord(gameCode: string) {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  await deleteRows(
    "games",
    new URLSearchParams({
      code: `eq.${normalizedGameCode}`
    })
  );
}

export async function listAdminPlayers(input: {
  page: number;
  pageSize: number;
  query?: string;
  gameCode?: string;
}) : Promise<AdminPlayersResponse> {
  const page = Math.max(1, input.page);
  const pageSize = Math.min(50, Math.max(1, input.pageSize));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const search = new URLSearchParams({
    select: "id,game_code,nickname,team,joined_at,last_seen_at,location_lat,location_lng,location_accuracy,location_updated_at",
    order: "last_seen_at.desc"
  });

  const query = input.query?.trim();
  if (query) {
    search.set("or", `(nickname.ilike.*${query}*,id.ilike.*${query}*,game_code.ilike.*${query}*)`);
  }

  const gameCode = normalizeGameCode(input.gameCode ?? null);
  if (gameCode) {
    search.set("game_code", `eq.${gameCode}`);
  }

  const result = await fetchRowsWithCount<PlayerRow>("players", search, { from, to });
  const gameCodes = Array.from(new Set(result.rows.map((row) => row.game_code)));
  const gameRows =
    gameCodes.length > 0
      ? await fetchRows<GameRow>(
          "games",
          new URLSearchParams({
            select:
              "code,name,description,status,map_reference,creation_metadata,created_at,updated_at,default_map_center_lat,default_map_center_lng",
            code: buildInFilter(gameCodes)
          })
        )
      : [];

  const gameNameByCode = new Map(gameRows.map((row) => [row.code, row.name?.trim() || `Game ${row.code}`]));

  return {
    items: result.rows.map((row) => playerRowToRecord(row, gameNameByCode.get(row.game_code) ?? `Game ${row.game_code}`)),
    total: result.count,
    page,
    pageSize
  };
}

export async function updateAdminPlayerRecord(gameCode: string, playerId: string, input: { nickname: string; team: Team }) {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  const nickname = input.nickname.trim();
  if (nickname.length < 2) {
    throw new Error("Nickname is required.");
  }

  const state = await updateState(normalizedGameCode, (current) => {
    const players = current.players ?? [];
    const index = players.findIndex((player) => player.id === playerId);
    if (index < 0) {
      throw new Error("Player not found.");
    }

    const nicknameKey = toNicknameLookupKey(nickname);
    const collision = players.some((player, currentIndex) => currentIndex !== index && toNicknameLookupKey(player.nickname) === nicknameKey);
    if (collision) {
      throw new Error("Nickname is already used in this game.");
    }

    const nextPlayers = [...players];
    nextPlayers[index] = {
      ...nextPlayers[index],
      nickname,
      team: input.team,
      lastSeenAt: new Date().toISOString()
    };

    return {
      ...current,
      players: nextPlayers
    };
  });

  return (state.players ?? []).find((player) => player.id === playerId) ?? null;
}

export async function updateAdminMarkerRecord(
  gameCode: string,
  markerId: string,
  input: {
    type?: MapMarker["type"];
    name: string;
    description?: string;
    icon?: string;
    color: string;
    lat: number;
    lng: number;
    visibility: MapMarker["visibility"];
    visibleTeams?: Team[];
  }
) {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  const state = await updateState(normalizedGameCode, (current) => {
    const markers = current.mapMarkers ?? [];
    const index = markers.findIndex((marker) => marker.id === markerId);
    if (index < 0) {
      throw new Error("Marker not found.");
    }

    const nextMarkers = [...markers];
    nextMarkers[index] = {
      ...nextMarkers[index],
      type: input.type,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      icon: input.icon?.trim() || undefined,
      color: normalizeMarkerColor(input.color) ?? "#5f676c",
      lat: Number(input.lat),
      lng: Number(input.lng),
      visibility: input.visibility,
      visibleTeams: input.visibility === "selected_teams" ? input.visibleTeams ?? [] : undefined,
      updatedAt: new Date().toISOString()
    };

    return {
      ...current,
      mapMarkers: nextMarkers
    };
  });

  return (state.mapMarkers ?? []).find((marker) => marker.id === markerId) ?? null;
}
