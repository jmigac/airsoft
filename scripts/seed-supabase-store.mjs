#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
  /\/+$/,
  ""
);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const GAME_STATE_ID = 1;
const STORE_SCHEMA_VERSION = 2;
const DEFAULT_GAME_CODE = (process.env.SEED_GAME_CODE ?? "LEGACY1").toUpperCase();
const MAP_MARKER_TYPES = new Set(["village", "north_spawn", "south_spawn", "house"]);
const MAP_MARKER_META = {
  village: { label: "Village", color: "#f0a020" },
  north_spawn: { label: "North Spawn", color: "#1f5ecf" },
  south_spawn: { label: "South Spawn", color: "#2ca34a" },
  house: { label: "House", color: "#7c4a2a" }
};

function normalizeMarkerColor(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}

function normalizeGameCode(value) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  return /^[A-Z0-9]{6}$/.test(cleaned) ? cleaned : null;
}

function assertEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing Supabase env. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is publishable. Use the service-role secret key from Supabase settings."
    );
  }
}

function buildHeaders(prefer) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {})
  };
}

function buildUrl(pathname, params = new URLSearchParams()) {
  return `${SUPABASE_URL}${pathname}?${params.toString()}`;
}

function normalizeState(input) {
  if (!input || typeof input !== "object") {
    return {
      missions: [],
      completions: [],
      defaultMapCenter: undefined,
      mapMarkers: [],
      mapShapes: [],
      mapSignals: []
    };
  }

  const defaultMapCenter =
    input.defaultMapCenter &&
    Number.isFinite(input.defaultMapCenter.lat) &&
    Number.isFinite(input.defaultMapCenter.lng)
      ? {
          lat: Number(input.defaultMapCenter.lat),
          lng: Number(input.defaultMapCenter.lng)
        }
      : undefined;

  const mapMarkers = Array.isArray(input.mapMarkers)
    ? input.mapMarkers
        .filter(
          (marker) =>
            marker &&
            typeof marker === "object" &&
            typeof marker.id === "string" &&
            Number.isFinite(marker.lat) &&
            Number.isFinite(marker.lng)
        )
        .map((marker) => ({
          type: MAP_MARKER_TYPES.has(marker.type) ? marker.type : undefined,
          id: marker.id,
          name:
            typeof marker.name === "string" && marker.name.trim().length > 0
              ? marker.name.trim()
              : MAP_MARKER_TYPES.has(marker.type)
                ? MAP_MARKER_META[marker.type].label
                : "Marker",
          color:
            normalizeMarkerColor(marker.color) ??
            (MAP_MARKER_TYPES.has(marker.type) ? MAP_MARKER_META[marker.type].color : "#5f676c"),
          lat: Number(marker.lat),
          lng: Number(marker.lng),
          createdAt: typeof marker.createdAt === "string" ? marker.createdAt : new Date().toISOString()
        }))
    : [];
  const mapShapes = Array.isArray(input.mapShapes)
    ? input.mapShapes
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

          return {
            id: shape.id,
            label:
              typeof shape.label === "string" && shape.label.trim().length > 0
                ? shape.label.trim()
                : "Shape",
            color: normalizeMarkerColor(shape.color) ?? "#5f676c",
            opacity:
              typeof shape.opacity === "number" && Number.isFinite(shape.opacity)
                ? Math.min(1, Math.max(0, shape.opacity))
                : 0.35,
            points,
            createdAt: typeof shape.createdAt === "string" ? shape.createdAt : new Date().toISOString()
          };
        })
    : [];
  const nowMs = Date.now();
  const mapSignals = Array.isArray(input.mapSignals)
    ? input.mapSignals
        .filter(
          (signal) =>
            signal &&
            typeof signal === "object" &&
            typeof signal.id === "string" &&
            (signal.type === "info" || signal.type === "danger" || signal.type === "intel") &&
            (signal.team === "red" || signal.team === "blue") &&
            Number.isFinite(signal.lat) &&
            Number.isFinite(signal.lng)
        )
        .map((signal) => {
          const expiresAtMs = Date.parse(
            typeof signal.expiresAt === "string" ? signal.expiresAt : new Date(0).toISOString()
          );

          return {
            id: signal.id,
            type: signal.type,
            team: signal.team,
            lat: Number(signal.lat),
            lng: Number(signal.lng),
            createdAt: typeof signal.createdAt === "string" ? signal.createdAt : new Date().toISOString(),
            expiresAt:
              Number.isFinite(expiresAtMs) && expiresAtMs > nowMs
                ? new Date(expiresAtMs).toISOString()
                : new Date(0).toISOString()
          };
        })
        .filter((signal) => Date.parse(signal.expiresAt) > nowMs)
    : [];

  return {
    missions: Array.isArray(input.missions) ? input.missions : [],
    completions: Array.isArray(input.completions) ? input.completions : [],
    defaultMapCenter,
    mapMarkers,
    mapShapes,
    mapSignals
  };
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${text || response.statusText}`);
  }

  return text ? JSON.parse(text) : null;
}

async function ensureRow() {
  const params = new URLSearchParams({
    on_conflict: "id",
    select: "id"
  });
  await requestJson(buildUrl("/rest/v1/game_state", params), {
    method: "POST",
    headers: buildHeaders("resolution=ignore-duplicates,return=representation"),
    body: JSON.stringify([
      {
        id: GAME_STATE_ID,
        state: { schemaVersion: STORE_SCHEMA_VERSION, games: {} },
        version: 1
      }
    ])
  });
}

async function readVersion() {
  const params = new URLSearchParams({
    select: "version",
    id: `eq.${GAME_STATE_ID}`,
    limit: "1"
  });
  const rows = await requestJson(buildUrl("/rest/v1/game_state", params), {
    method: "GET",
    headers: buildHeaders()
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("game_state row not found after initialization.");
  }

  const version = Number(rows[0].version);
  return Number.isFinite(version) ? version : 1;
}

async function main() {
  assertEnv();

  const sourceArg = process.argv[2] ?? "data/store.json";
  const sourcePath = path.resolve(process.cwd(), sourceArg);
  const raw = await readFile(sourcePath, "utf8");
  const parsed = JSON.parse(raw);
  const state = normalizeState(parsed);
  const seedGameCode = normalizeGameCode(process.argv[3] ?? DEFAULT_GAME_CODE);
  if (!seedGameCode) {
    throw new Error("Invalid seed game code. Use a 6-character alphanumeric invite code.");
  }
  const store = {
    schemaVersion: STORE_SCHEMA_VERSION,
    games: {
      [seedGameCode]: state
    }
  };

  await ensureRow();
  const currentVersion = await readVersion();

  const params = new URLSearchParams({
    select: "id",
    id: `eq.${GAME_STATE_ID}`
  });

  await requestJson(buildUrl("/rest/v1/game_state", params), {
    method: "PATCH",
    headers: buildHeaders("return=representation"),
    body: JSON.stringify({
      state: store,
      version: currentVersion + 1
    })
  });

  console.log(`Seeded Supabase game_state from ${sourcePath} into game ${seedGameCode}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
