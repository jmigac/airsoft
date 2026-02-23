import "server-only";
import { isMapMarkerType, MAP_MARKER_META, normalizeMarkerColor } from "./map-markers";
import { isMapSignalType } from "./map-signals";
import { normalizeGameCode } from "./game-code";
import { toNicknameLookupKey } from "./player-utils";
import { GameState, Team } from "./types";

const MAX_UPDATE_RETRIES = 8;
const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type GameRow = {
  code: string;
  version: number;
  default_map_center_lat: number | null;
  default_map_center_lng: number | null;
};

type MissionRow = {
  id: string;
  game_code: string;
  name: string;
  qr_code: string;
  map_center_lat: number | null;
  map_center_lng: number | null;
  time_window_starts_at_cet: string | null;
  time_window_ends_at_cet: string | null;
  created_at: string;
};

type MissionLocationRow = {
  id: string;
  game_code: string;
  mission_id: string;
  lat: number;
  lng: number;
  radius: number;
  sort_order: number;
};

type CompletionRow = {
  id: string;
  game_code: string;
  mission_id: string;
  team: string;
  qr_code: string;
  completed_at: string;
};

type PlayerRow = {
  id: string;
  game_code: string;
  session_id: string;
  nickname: string;
  nickname_key: string;
  team: string;
  joined_at: string;
  last_seen_at: string;
  location_lat: number | null;
  location_lng: number | null;
  location_accuracy: number | null;
  location_updated_at: string | null;
};

type MapMarkerRow = {
  id: string;
  game_code: string;
  type: string | null;
  name: string;
  color: string;
  lat: number;
  lng: number;
  created_at: string;
};

type MapShapeRow = {
  id: string;
  game_code: string;
  label: string;
  color: string;
  opacity: number;
  created_at: string;
};

type MapShapePointRow = {
  shape_id: string;
  game_code: string;
  point_index: number;
  lat: number;
  lng: number;
};

type MapSignalRow = {
  id: string;
  game_code: string;
  type: string;
  team: string;
  lat: number;
  lng: number;
  created_at: string;
  expires_at: string;
};

function createInitialState(): GameState {
  return {
    missions: [],
    completions: [],
    players: [],
    defaultMapCenter: undefined,
    mapMarkers: [],
    mapShapes: [],
    mapSignals: []
  };
}

function asTeam(value: unknown): Team | null {
  return value === "red" || value === "blue" ? value : null;
}

function normalizeIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return new Date(parsed).toISOString();
}

function normalizeState(value: unknown): GameState {
  if (!value || typeof value !== "object") {
    return createInitialState();
  }

  const nowIso = new Date().toISOString();
  const candidate = value as Partial<GameState>;

  const missions = Array.isArray(candidate.missions)
    ? candidate.missions
        .filter((mission) => mission && typeof mission === "object" && typeof mission.id === "string")
        .map((mission) => {
          const mapCenter =
            mission.mapCenter && Number.isFinite(mission.mapCenter.lat) && Number.isFinite(mission.mapCenter.lng)
              ? {
                  lat: Number(mission.mapCenter.lat),
                  lng: Number(mission.mapCenter.lng)
                }
              : undefined;

          const timeWindowCET =
            mission.timeWindowCET &&
            typeof mission.timeWindowCET.startsAtCET === "string" &&
            typeof mission.timeWindowCET.endsAtCET === "string" &&
            mission.timeWindowCET.startsAtCET.trim().length > 0 &&
            mission.timeWindowCET.endsAtCET.trim().length > 0
              ? {
                  startsAtCET: mission.timeWindowCET.startsAtCET.trim(),
                  endsAtCET: mission.timeWindowCET.endsAtCET.trim()
                }
              : undefined;

          const locations = Array.isArray(mission.locations)
            ? mission.locations
                .filter(
                  (location) =>
                    location &&
                    typeof location === "object" &&
                    typeof location.id === "string" &&
                    Number.isFinite(location.lat) &&
                    Number.isFinite(location.lng) &&
                    Number.isFinite(location.radius)
                )
                .map((location) => ({
                  id: location.id,
                  lat: Number(location.lat),
                  lng: Number(location.lng),
                  radius: Number(location.radius)
                }))
            : [];

          return {
            id: mission.id,
            name: typeof mission.name === "string" && mission.name.trim().length > 0 ? mission.name.trim() : "Mission",
            qrCode: typeof mission.qrCode === "string" ? mission.qrCode.trim() : "",
            mapCenter,
            timeWindowCET,
            createdAt: normalizeIsoTimestamp(mission.createdAt, nowIso),
            locations
          };
        })
    : [];

  const completions = Array.isArray(candidate.completions)
    ? candidate.completions
        .filter(
          (completion) =>
            completion &&
            typeof completion === "object" &&
            typeof completion.id === "string" &&
            typeof completion.missionId === "string" &&
            asTeam(completion.team) !== null
        )
        .map((completion) => ({
          id: completion.id,
          missionId: completion.missionId,
          team: asTeam(completion.team) ?? "red",
          qrCode: typeof completion.qrCode === "string" ? completion.qrCode.trim() : "",
          completedAt: normalizeIsoTimestamp(completion.completedAt, nowIso)
        }))
    : [];

  const players = Array.isArray(candidate.players)
    ? candidate.players
        .filter(
          (player) =>
            player &&
            typeof player === "object" &&
            typeof player.id === "string" &&
            typeof player.sessionId === "string" &&
            typeof player.nickname === "string" &&
            asTeam(player.team) !== null
        )
        .map((player) => {
          const location =
            player.location &&
            typeof player.location === "object" &&
            Number.isFinite(player.location.lat) &&
            Number.isFinite(player.location.lng)
              ? {
                  lat: Number(player.location.lat),
                  lng: Number(player.location.lng),
                  accuracy:
                    typeof player.location.accuracy === "number" && Number.isFinite(player.location.accuracy)
                      ? player.location.accuracy
                      : undefined,
                  updatedAt: normalizeIsoTimestamp(player.location.updatedAt, nowIso)
                }
              : undefined;

          return {
            id: player.id,
            sessionId: player.sessionId,
            nickname: player.nickname.trim().slice(0, 24),
            team: asTeam(player.team) ?? "red",
            joinedAt: normalizeIsoTimestamp(player.joinedAt, nowIso),
            lastSeenAt: normalizeIsoTimestamp(player.lastSeenAt, nowIso),
            location
          };
        })
    : [];

  const defaultMapCenter =
    candidate.defaultMapCenter &&
    Number.isFinite(candidate.defaultMapCenter.lat) &&
    Number.isFinite(candidate.defaultMapCenter.lng)
      ? {
          lat: Number(candidate.defaultMapCenter.lat),
          lng: Number(candidate.defaultMapCenter.lng)
        }
      : undefined;

  const mapMarkers = Array.isArray(candidate.mapMarkers)
    ? candidate.mapMarkers
        .filter(
          (marker) =>
            marker &&
            typeof marker === "object" &&
            typeof marker.id === "string" &&
            Number.isFinite(marker.lat) &&
            Number.isFinite(marker.lng)
        )
        .map((marker) => {
          const markerType =
            typeof marker.type === "string" && isMapMarkerType(marker.type) ? marker.type : undefined;
          const fallback = markerType ? MAP_MARKER_META[markerType] : null;
          const color = typeof marker.color === "string" ? normalizeMarkerColor(marker.color) : null;

          return {
            id: marker.id,
            type: markerType,
            name:
              typeof marker.name === "string" && marker.name.trim().length > 0
                ? marker.name.trim()
                : fallback?.label ?? "Marker",
            color: color ?? fallback?.color ?? "#5f676c",
            lat: Number(marker.lat),
            lng: Number(marker.lng),
            createdAt: normalizeIsoTimestamp(marker.createdAt, nowIso)
          };
        })
    : [];

  const mapShapes = Array.isArray(candidate.mapShapes)
    ? candidate.mapShapes
        .filter((shape) => shape && typeof shape === "object" && typeof shape.id === "string")
        .map((shape) => {
          const points = Array.isArray(shape.points)
            ? shape.points
                .filter(
                  (point) =>
                    point && typeof point === "object" && Number.isFinite(point.lat) && Number.isFinite(point.lng)
                )
                .map((point) => ({
                  lat: Number(point.lat),
                  lng: Number(point.lng)
                }))
            : [];

          const color = typeof shape.color === "string" ? normalizeMarkerColor(shape.color) : null;
          const opacity =
            typeof shape.opacity === "number" && Number.isFinite(shape.opacity)
              ? Math.min(1, Math.max(0, shape.opacity))
              : 0.35;

          return {
            id: shape.id,
            label: typeof shape.label === "string" && shape.label.trim().length > 0 ? shape.label.trim() : "Shape",
            color: color ?? "#5f676c",
            opacity,
            points,
            createdAt: normalizeIsoTimestamp(shape.createdAt, nowIso)
          };
        })
    : [];

  const nowMs = Date.now();
  const mapSignals = Array.isArray(candidate.mapSignals)
    ? candidate.mapSignals
        .filter(
          (signal) =>
            signal &&
            typeof signal === "object" &&
            typeof signal.id === "string" &&
            typeof signal.type === "string" &&
            isMapSignalType(signal.type) &&
            asTeam(signal.team) !== null &&
            Number.isFinite(signal.lat) &&
            Number.isFinite(signal.lng)
        )
        .map((signal) => ({
          id: signal.id,
          type: signal.type,
          team: asTeam(signal.team) ?? "red",
          lat: Number(signal.lat),
          lng: Number(signal.lng),
          createdAt: normalizeIsoTimestamp(signal.createdAt, nowIso),
          expiresAt: normalizeIsoTimestamp(signal.expiresAt, nowIso)
        }))
        .filter((signal) => Date.parse(signal.expiresAt) > nowMs)
    : [];

  return {
    missions,
    completions,
    players,
    defaultMapCenter,
    mapMarkers,
    mapShapes,
    mapSignals
  };
}

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is using a publishable key. Use the Supabase service-role secret key (sb_secret_* or legacy service_role JWT)."
    );
  }
}

function buildUrl(pathname: string, search?: URLSearchParams) {
  assertSupabaseConfig();
  const query = search?.toString();
  return `${SUPABASE_URL}${pathname}${query ? `?${query}` : ""}`;
}

function buildHeaders(prefer?: string) {
  assertSupabaseConfig();
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {})
  };
}

async function parseResponseError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`;
  const raw = await response.text();

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string; details?: string };
    return parsed.message ?? parsed.error ?? parsed.details ?? raw;
  } catch {
    return raw;
  }
}

async function requestJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: "no-store"
  });

  if (!response.ok) {
    const details = await parseResponseError(response);
    throw new Error(`Supabase request failed: ${details}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function fetchRows<T>(table: string, search: URLSearchParams): Promise<T[]> {
  return requestJson<T[]>(buildUrl(`/rest/v1/${table}`, search), {
    method: "GET",
    headers: buildHeaders()
  });
}

async function deleteByGameCode(table: string, gameCode: string): Promise<void> {
  const search = new URLSearchParams({ game_code: `eq.${gameCode}` });
  await requestJson<unknown>(buildUrl(`/rest/v1/${table}`, search), {
    method: "DELETE",
    headers: buildHeaders("return=minimal")
  });
}

async function insertRows<T>(table: string, rows: T[]): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  await requestJson<unknown>(buildUrl(`/rest/v1/${table}`), {
    method: "POST",
    headers: buildHeaders("return=minimal"),
    body: JSON.stringify(rows)
  });
}

async function selectGameRow(gameCode: string): Promise<GameRow | null> {
  const search = new URLSearchParams({
    select: "code,version,default_map_center_lat,default_map_center_lng",
    code: `eq.${gameCode}`,
    limit: "1"
  });

  const rows = await fetchRows<GameRow>("games", search);
  return rows[0] ?? null;
}

function normalizeGameVersion(row: GameRow): number {
  const version = Number(row.version);
  return Number.isFinite(version) ? version : 1;
}

async function readStateWithVersion(gameCode: string): Promise<{ state: GameState; version: number }> {
  const game = await selectGameRow(gameCode);
  if (!game) {
    throw new Error("Game not found.");
  }

  const nowIso = new Date().toISOString();
  const [missionRows, locationRows, completionRows, playerRows, markerRows, shapeRows, shapePointRows, signalRows] =
    await Promise.all([
      fetchRows<MissionRow>(
        "missions",
        new URLSearchParams({
          select:
            "id,game_code,name,qr_code,map_center_lat,map_center_lng,time_window_starts_at_cet,time_window_ends_at_cet,created_at",
          game_code: `eq.${gameCode}`,
          order: "created_at.asc"
        })
      ),
      fetchRows<MissionLocationRow>(
        "mission_locations",
        new URLSearchParams({
          select: "id,game_code,mission_id,lat,lng,radius,sort_order",
          game_code: `eq.${gameCode}`,
          order: "mission_id.asc,sort_order.asc"
        })
      ),
      fetchRows<CompletionRow>(
        "completions",
        new URLSearchParams({
          select: "id,game_code,mission_id,team,qr_code,completed_at",
          game_code: `eq.${gameCode}`,
          order: "completed_at.asc"
        })
      ),
      fetchRows<PlayerRow>(
        "players",
        new URLSearchParams({
          select:
            "id,game_code,session_id,nickname,nickname_key,team,joined_at,last_seen_at,location_lat,location_lng,location_accuracy,location_updated_at",
          game_code: `eq.${gameCode}`,
          order: "joined_at.asc"
        })
      ),
      fetchRows<MapMarkerRow>(
        "map_markers",
        new URLSearchParams({
          select: "id,game_code,type,name,color,lat,lng,created_at",
          game_code: `eq.${gameCode}`,
          order: "created_at.asc"
        })
      ),
      fetchRows<MapShapeRow>(
        "map_shapes",
        new URLSearchParams({
          select: "id,game_code,label,color,opacity,created_at",
          game_code: `eq.${gameCode}`,
          order: "created_at.asc"
        })
      ),
      fetchRows<MapShapePointRow>(
        "map_shape_points",
        new URLSearchParams({
          select: "shape_id,game_code,point_index,lat,lng",
          game_code: `eq.${gameCode}`,
          order: "shape_id.asc,point_index.asc"
        })
      ),
      fetchRows<MapSignalRow>(
        "map_signals",
        new URLSearchParams({
          select: "id,game_code,type,team,lat,lng,created_at,expires_at",
          game_code: `eq.${gameCode}`,
          expires_at: `gt.${nowIso}`,
          order: "created_at.asc"
        })
      )
    ]);

  const missionLocationsByMissionId = new Map<string, Array<{ id: string; lat: number; lng: number; radius: number }>>();
  for (const row of locationRows) {
    const list = missionLocationsByMissionId.get(row.mission_id) ?? [];
    list.push({
      id: row.id,
      lat: Number(row.lat),
      lng: Number(row.lng),
      radius: Number(row.radius)
    });
    missionLocationsByMissionId.set(row.mission_id, list);
  }

  const shapePointsByShapeId = new Map<string, Array<{ lat: number; lng: number }>>();
  for (const row of shapePointRows) {
    const list = shapePointsByShapeId.get(row.shape_id) ?? [];
    list.push({
      lat: Number(row.lat),
      lng: Number(row.lng)
    });
    shapePointsByShapeId.set(row.shape_id, list);
  }

  const state: GameState = {
    missions: missionRows
      .map((row) => ({
        id: row.id,
        name: row.name,
        qrCode: row.qr_code,
        mapCenter:
          Number.isFinite(row.map_center_lat) && Number.isFinite(row.map_center_lng)
            ? {
                lat: Number(row.map_center_lat),
                lng: Number(row.map_center_lng)
              }
            : undefined,
        timeWindowCET:
          typeof row.time_window_starts_at_cet === "string" &&
          row.time_window_starts_at_cet.trim().length > 0 &&
          typeof row.time_window_ends_at_cet === "string" &&
          row.time_window_ends_at_cet.trim().length > 0
            ? {
                startsAtCET: row.time_window_starts_at_cet,
                endsAtCET: row.time_window_ends_at_cet
              }
            : undefined,
        createdAt: normalizeIsoTimestamp(row.created_at, nowIso),
        locations: missionLocationsByMissionId.get(row.id) ?? []
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    completions: completionRows
      .map((row) => {
        const team = asTeam(row.team);
        if (!team) {
          return null;
        }

        return {
          id: row.id,
          missionId: row.mission_id,
          team,
          qrCode: row.qr_code,
          completedAt: normalizeIsoTimestamp(row.completed_at, nowIso)
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt)),
    players: playerRows
      .map((row) => {
        const team = asTeam(row.team);
        if (!team) {
          return null;
        }

        const hasLocation =
          Number.isFinite(row.location_lat) &&
          Number.isFinite(row.location_lng) &&
          typeof row.location_updated_at === "string";

        return {
          id: row.id,
          sessionId: row.session_id,
          nickname: row.nickname,
          team,
          joinedAt: normalizeIsoTimestamp(row.joined_at, nowIso),
          lastSeenAt: normalizeIsoTimestamp(row.last_seen_at, nowIso),
          location: hasLocation
            ? {
                lat: Number(row.location_lat),
                lng: Number(row.location_lng),
                accuracy:
                  typeof row.location_accuracy === "number" && Number.isFinite(row.location_accuracy)
                    ? row.location_accuracy
                    : undefined,
                updatedAt: normalizeIsoTimestamp(row.location_updated_at, nowIso)
              }
            : undefined
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
    defaultMapCenter:
      Number.isFinite(game.default_map_center_lat) && Number.isFinite(game.default_map_center_lng)
        ? {
            lat: Number(game.default_map_center_lat),
            lng: Number(game.default_map_center_lng)
          }
        : undefined,
    mapMarkers: markerRows
      .map((row) => {
        const markerType = typeof row.type === "string" && isMapMarkerType(row.type) ? row.type : undefined;
        const fallback = markerType ? MAP_MARKER_META[markerType] : null;

        return {
          id: row.id,
          type: markerType,
          name: typeof row.name === "string" && row.name.trim().length > 0 ? row.name.trim() : fallback?.label ?? "Marker",
          color: normalizeMarkerColor(row.color) ?? fallback?.color ?? "#5f676c",
          lat: Number(row.lat),
          lng: Number(row.lng),
          createdAt: normalizeIsoTimestamp(row.created_at, nowIso)
        };
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    mapShapes: shapeRows
      .map((row) => ({
        id: row.id,
        label: typeof row.label === "string" && row.label.trim().length > 0 ? row.label.trim() : "Shape",
        color: normalizeMarkerColor(row.color) ?? "#5f676c",
        opacity: Math.min(1, Math.max(0, Number(row.opacity))),
        points: shapePointsByShapeId.get(row.id) ?? [],
        createdAt: normalizeIsoTimestamp(row.created_at, nowIso)
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    mapSignals: signalRows
      .map((row) => {
        const team = asTeam(row.team);
        if (!team || !isMapSignalType(row.type)) {
          return null;
        }

        return {
          id: row.id,
          type: row.type,
          team,
          lat: Number(row.lat),
          lng: Number(row.lng),
          createdAt: normalizeIsoTimestamp(row.created_at, nowIso),
          expiresAt: normalizeIsoTimestamp(row.expires_at, nowIso)
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .filter((signal) => Date.parse(signal.expiresAt) > Date.now())
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  };

  return {
    state,
    version: normalizeGameVersion(game)
  };
}

async function setGameCenterAndVersion(
  gameCode: string,
  options: {
    expectedVersion?: number;
    nextVersion?: number;
    center?: { lat: number; lng: number } | null;
  }
): Promise<boolean> {
  const payload = {
    default_map_center_lat: options.center ? Number(options.center.lat) : null,
    default_map_center_lng: options.center ? Number(options.center.lng) : null,
    ...(typeof options.nextVersion === "number" ? { version: options.nextVersion } : {})
  };

  const search = new URLSearchParams({
    select: "code,version",
    code: `eq.${gameCode}`,
    ...(typeof options.expectedVersion === "number" ? { version: `eq.${options.expectedVersion}` } : {})
  });

  const rows = await requestJson<Array<{ code: string; version: number }>>(buildUrl("/rest/v1/games", search), {
    method: "PATCH",
    headers: buildHeaders("return=representation"),
    body: JSON.stringify(payload)
  });

  return rows.length === 1;
}

async function replaceGameCollections(gameCode: string, nextState: GameState): Promise<void> {
  await deleteByGameCode("mission_locations", gameCode);
  await deleteByGameCode("completions", gameCode);
  await deleteByGameCode("missions", gameCode);
  await deleteByGameCode("map_shape_points", gameCode);
  await deleteByGameCode("map_shapes", gameCode);
  await deleteByGameCode("map_markers", gameCode);
  await deleteByGameCode("players", gameCode);
  await deleteByGameCode("map_signals", gameCode);

  const missionRows = nextState.missions.map((mission) => ({
    id: mission.id,
    game_code: gameCode,
    name: mission.name,
    qr_code: mission.qrCode,
    map_center_lat: mission.mapCenter ? Number(mission.mapCenter.lat) : null,
    map_center_lng: mission.mapCenter ? Number(mission.mapCenter.lng) : null,
    time_window_starts_at_cet: mission.timeWindowCET?.startsAtCET ?? null,
    time_window_ends_at_cet: mission.timeWindowCET?.endsAtCET ?? null,
    created_at: mission.createdAt
  }));

  const missionLocationRows = nextState.missions.flatMap((mission) =>
    mission.locations.map((location, index) => ({
      id: location.id,
      game_code: gameCode,
      mission_id: mission.id,
      lat: Number(location.lat),
      lng: Number(location.lng),
      radius: Number(location.radius),
      sort_order: index
    }))
  );

  const completionRows = nextState.completions.map((completion) => ({
    id: completion.id,
    game_code: gameCode,
    mission_id: completion.missionId,
    team: completion.team,
    qr_code: completion.qrCode,
    completed_at: completion.completedAt
  }));

  const playerRows = (nextState.players ?? []).map((player) => ({
    id: player.id,
    game_code: gameCode,
    session_id: player.sessionId,
    nickname: player.nickname,
    nickname_key: toNicknameLookupKey(player.nickname),
    team: player.team,
    joined_at: player.joinedAt,
    last_seen_at: player.lastSeenAt,
    location_lat: player.location ? Number(player.location.lat) : null,
    location_lng: player.location ? Number(player.location.lng) : null,
    location_accuracy: typeof player.location?.accuracy === "number" ? player.location.accuracy : null,
    location_updated_at: player.location?.updatedAt ?? null
  }));

  const markerRows = (nextState.mapMarkers ?? []).map((marker) => ({
    id: marker.id,
    game_code: gameCode,
    type: marker.type ?? null,
    name: marker.name,
    color: normalizeMarkerColor(marker.color) ?? "#5f676c",
    lat: Number(marker.lat),
    lng: Number(marker.lng),
    created_at: marker.createdAt
  }));

  const shapeRows = (nextState.mapShapes ?? []).map((shape) => ({
    id: shape.id,
    game_code: gameCode,
    label: shape.label,
    color: normalizeMarkerColor(shape.color) ?? "#5f676c",
    opacity: Math.min(1, Math.max(0, shape.opacity)),
    created_at: shape.createdAt
  }));

  const shapePointRows = (nextState.mapShapes ?? []).flatMap((shape) =>
    shape.points.map((point, index) => ({
      shape_id: shape.id,
      game_code: gameCode,
      point_index: index,
      lat: Number(point.lat),
      lng: Number(point.lng)
    }))
  );

  const nowMs = Date.now();
  const signalRows = (nextState.mapSignals ?? [])
    .filter((signal) => Date.parse(signal.expiresAt) > nowMs)
    .map((signal) => ({
      id: signal.id,
      game_code: gameCode,
      type: signal.type,
      team: signal.team,
      lat: Number(signal.lat),
      lng: Number(signal.lng),
      created_at: signal.createdAt,
      expires_at: signal.expiresAt
    }));

  await insertRows("missions", missionRows);
  await insertRows("mission_locations", missionLocationRows);
  await insertRows("completions", completionRows);
  await insertRows("players", playerRows);
  await insertRows("map_markers", markerRows);
  await insertRows("map_shapes", shapeRows);
  await insertRows("map_shape_points", shapePointRows);
  await insertRows("map_signals", signalRows);
}

export async function gameExists(gameCode: string): Promise<boolean> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    return false;
  }

  const row = await selectGameRow(normalizedGameCode);
  return Boolean(row);
}

export async function createGame(gameCode: string): Promise<GameState> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  try {
    const rows = await requestJson<GameRow[]>(
      buildUrl("/rest/v1/games", new URLSearchParams({ select: "code,version,default_map_center_lat,default_map_center_lng" })),
      {
        method: "POST",
        headers: buildHeaders("return=representation"),
        body: JSON.stringify([{ code: normalizedGameCode }])
      }
    );

    if (rows.length !== 1) {
      throw new Error("Could not initialize game.");
    }

    return createInitialState();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not initialize game.";
    if (message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("unique")) {
      throw new Error("Game already exists.");
    }
    throw error;
  }
}

export async function readState(gameCode: string): Promise<GameState> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  const { state } = await readStateWithVersion(normalizedGameCode);
  return state;
}

export async function writeState(gameCode: string, state: GameState): Promise<void> {
  await updateState(gameCode, () => state);
}

export async function updateState(gameCode: string, updater: (current: GameState) => GameState): Promise<GameState> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  for (let attempt = 1; attempt <= MAX_UPDATE_RETRIES; attempt += 1) {
    const snapshot = await readStateWithVersion(normalizedGameCode);
    const nextState = normalizeState(updater(snapshot.state));

    const acquired = await setGameCenterAndVersion(normalizedGameCode, {
      expectedVersion: snapshot.version,
      nextVersion: snapshot.version + 1,
      center: nextState.defaultMapCenter ?? null
    });

    if (!acquired) {
      continue;
    }

    await replaceGameCollections(normalizedGameCode, nextState);
    return nextState;
  }

  throw new Error("Could not update game state due to concurrent writes. Please retry.");
}
