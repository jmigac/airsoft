import "server-only";
import { GameState } from "./types";

const INITIAL_STATE: GameState = {
  missions: [],
  completions: []
};

const GAME_STATE_ID = 1;
const MAX_UPDATE_RETRIES = 8;
const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
  /\/+$/,
  ""
);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

type GameStateRow = {
  state: GameState;
  version: number;
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
    return INITIAL_STATE;
  }

  const candidate = value as Partial<GameState>;
  return {
    missions: Array.isArray(candidate.missions) ? candidate.missions : [],
    completions: Array.isArray(candidate.completions) ? candidate.completions : []
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

  return (await response.json()) as T;
}

async function selectStateRow(): Promise<GameStateRow | null> {
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
    state: normalizeState(row.state),
    version: Number.isFinite(row.version) ? row.version : 1
  };
}

async function ensureStateRow(): Promise<GameStateRow> {
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
          state: INITIAL_STATE,
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

export async function readState(): Promise<GameState> {
  const row = await ensureStateRow();
  return row.state;
}

export async function writeState(state: GameState): Promise<void> {
  await ensureStateRow();

  const search = new URLSearchParams({
    select: "state",
    id: `eq.${GAME_STATE_ID}`
  });

  const rows = await requestJson<Array<{ state: unknown }>>(
    buildUrl("/rest/v1/game_state", search),
    {
      method: "PATCH",
      headers: buildHeaders("return=representation"),
      body: JSON.stringify({
        state: normalizeState(state)
      })
    }
  );

  if (rows.length !== 1) {
    throw new Error("Could not persist game state to Supabase.");
  }
}

export async function updateState(
  updater: (current: GameState) => GameState
): Promise<GameState> {
  for (let attempt = 1; attempt <= MAX_UPDATE_RETRIES; attempt += 1) {
    const current = await ensureStateRow();
    const next = normalizeState(updater(current.state));

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
      return normalizeState(rows[0].state);
    }
  }

  throw new Error("Could not update game state due to concurrent writes. Please retry.");
}
