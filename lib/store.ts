import "server-only";
import { isMapMarkerType, normalizeMarkerColor, MAP_MARKER_META } from "./map-markers";
import { normalizeGameCode } from "./game-code";
import { GameState } from "./types";

const GAME_STATE_ID = 1;
const MAX_UPDATE_RETRIES = 8;
const STORE_SCHEMA_VERSION = 2;
export const LEGACY_GAME_CODE = "LEGACY1";
const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
  /\/+$/,
  ""
);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type PersistedGameStore = {
  schemaVersion: number;
  games: Record<string, GameState>;
};

type StoreRow = {
  store: PersistedGameStore;
  version: number;
};

function createInitialState(): GameState {
  return {
    missions: [],
    completions: [],
    defaultMapCenter: undefined,
    mapMarkers: [],
    mapShapes: []
  };
}

const INITIAL_STORE: PersistedGameStore = {
  schemaVersion: STORE_SCHEMA_VERSION,
  games: {}
};

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

function normalizeState(value: unknown): GameState {
  if (!value || typeof value !== "object") {
    return createInitialState();
  }

  const candidate = value as Partial<GameState>;
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
          const name =
            typeof marker.name === "string" && marker.name.trim().length > 0
              ? marker.name.trim()
              : fallback?.label ?? "Marker";
          const color =
            typeof marker.color === "string" ? normalizeMarkerColor(marker.color) : null;

          return {
            id: marker.id,
            type: markerType,
            name,
            color: color ?? fallback?.color ?? "#5f676c",
            lat: Number(marker.lat),
            lng: Number(marker.lng),
            createdAt: typeof marker.createdAt === "string" ? marker.createdAt : new Date().toISOString()
          };
        })
    : [];
  const mapShapes = Array.isArray(candidate.mapShapes)
    ? candidate.mapShapes
        .filter(
          (shape) =>
            shape &&
            typeof shape === "object" &&
            typeof shape.id === "string" &&
            Array.isArray(shape.points)
        )
        .map((shape) => {
          const points = shape.points
            .filter(
              (point) =>
                point &&
                typeof point === "object" &&
                Number.isFinite(point.lat) &&
                Number.isFinite(point.lng)
            )
            .map((point) => ({
              lat: Number(point.lat),
              lng: Number(point.lng)
            }));
          const normalizedOpacity =
            typeof shape.opacity === "number" && Number.isFinite(shape.opacity)
              ? Math.min(1, Math.max(0, shape.opacity))
              : 0.35;
          const normalizedColor =
            typeof shape.color === "string" ? normalizeMarkerColor(shape.color) : null;
          const label =
            typeof shape.label === "string" && shape.label.trim().length > 0
              ? shape.label.trim()
              : "Shape";

          return {
            id: shape.id,
            label,
            color: normalizedColor ?? "#5f676c",
            opacity: normalizedOpacity,
            points,
            createdAt: typeof shape.createdAt === "string" ? shape.createdAt : new Date().toISOString()
          };
        })
    : [];

  return {
    missions: Array.isArray(candidate.missions) ? candidate.missions : [],
    completions: Array.isArray(candidate.completions) ? candidate.completions : [],
    defaultMapCenter,
    mapMarkers,
    mapShapes
  };
}

function looksLikeLegacySingleGameState(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GameState>;
  return Array.isArray(candidate.missions) || Array.isArray(candidate.completions);
}

function normalizeStore(value: unknown): PersistedGameStore {
  if (!value || typeof value !== "object") {
    return INITIAL_STORE;
  }

  const candidate = value as { schemaVersion?: unknown; games?: unknown };
  if (candidate.games && typeof candidate.games === "object") {
    const normalizedGames: Record<string, GameState> = {};

    for (const [rawCode, rawState] of Object.entries(candidate.games as Record<string, unknown>)) {
      const gameCode = normalizeGameCode(rawCode);
      if (!gameCode) {
        continue;
      }
      normalizedGames[gameCode] = normalizeState(rawState);
    }

    return {
      schemaVersion:
        typeof candidate.schemaVersion === "number" && Number.isFinite(candidate.schemaVersion)
          ? candidate.schemaVersion
          : STORE_SCHEMA_VERSION,
      games: normalizedGames
    };
  }

  if (looksLikeLegacySingleGameState(value)) {
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      games: {
        [LEGACY_GAME_CODE]: normalizeState(value)
      }
    };
  }

  return INITIAL_STORE;
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

  return (await response.json()) as T;
}

async function selectStateRow(): Promise<StoreRow | null> {
  const search = new URLSearchParams({
    select: "state,version",
    id: `eq.${GAME_STATE_ID}`,
    limit: "1"
  });
  const rows = await requestJson<Array<{ state: unknown; version: number }>>(
    buildUrl("/rest/v1/game_state", search),
    {
      method: "GET",
      headers: buildHeaders()
    }
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    store: normalizeStore(row.state),
    version: Number.isFinite(row.version) ? row.version : 1
  };
}

async function ensureStateRow(): Promise<StoreRow> {
  const existing = await selectStateRow();
  if (existing) {
    return existing;
  }

  const search = new URLSearchParams({
    on_conflict: "id",
    select: "state,version"
  });

  await requestJson<Array<{ state: unknown; version: number }>>(
    buildUrl("/rest/v1/game_state", search),
    {
      method: "POST",
      headers: buildHeaders("resolution=ignore-duplicates,return=representation"),
      body: JSON.stringify([
        {
          id: GAME_STATE_ID,
          state: INITIAL_STORE,
          version: 1
        }
      ])
    }
  );

  const created = await selectStateRow();
  if (!created) {
    throw new Error("Could not initialize Supabase game state row.");
  }

  return created;
}

async function updateStore(
  updater: (current: PersistedGameStore) => PersistedGameStore
): Promise<PersistedGameStore> {
  for (let attempt = 1; attempt <= MAX_UPDATE_RETRIES; attempt += 1) {
    const current = await ensureStateRow();
    const next = normalizeStore(updater(current.store));

    const search = new URLSearchParams({
      select: "state,version",
      id: `eq.${GAME_STATE_ID}`,
      version: `eq.${current.version}`
    });

    const rows = await requestJson<Array<{ state: unknown; version: number }>>(
      buildUrl("/rest/v1/game_state", search),
      {
        method: "PATCH",
        headers: buildHeaders("return=representation"),
        body: JSON.stringify({
          state: next,
          version: current.version + 1
        })
      }
    );

    if (rows.length === 1) {
      return normalizeStore(rows[0].state);
    }
  }

  throw new Error("Could not update game state due to concurrent writes. Please retry.");
}

export async function gameExists(gameCode: string): Promise<boolean> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    return false;
  }

  const row = await ensureStateRow();
  return Boolean(row.store.games[normalizedGameCode]);
}

export async function createGame(gameCode: string): Promise<GameState> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  const nextStore = await updateStore((current) => {
    if (current.games[normalizedGameCode]) {
      throw new Error("Game already exists.");
    }

    return {
      ...current,
      games: {
        ...current.games,
        [normalizedGameCode]: createInitialState()
      }
    };
  });

  const created = nextStore.games[normalizedGameCode];
  if (!created) {
    throw new Error("Could not initialize game.");
  }

  return created;
}

export async function readState(gameCode: string): Promise<GameState> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  const row = await ensureStateRow();
  const state = row.store.games[normalizedGameCode];
  if (!state) {
    throw new Error("Game not found.");
  }
  return state;
}

export async function writeState(gameCode: string, state: GameState): Promise<void> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  await updateStore((current) => ({
    ...current,
    games: {
      ...current.games,
      [normalizedGameCode]: normalizeState(state)
    }
  }));
}

export async function updateState(
  gameCode: string,
  updater: (current: GameState) => GameState
): Promise<GameState> {
  const normalizedGameCode = normalizeGameCode(gameCode);
  if (!normalizedGameCode) {
    throw new Error("Invalid game code.");
  }

  const nextStore = await updateStore((current) => {
    const previousState = current.games[normalizedGameCode];
    if (!previousState) {
      throw new Error("Game not found.");
    }

    return {
      ...current,
      games: {
        ...current.games,
        [normalizedGameCode]: normalizeState(updater(previousState))
      }
    };
  });

  const state = nextStore.games[normalizedGameCode];
  if (!state) {
    throw new Error("Game not found.");
  }

  return state;
}
