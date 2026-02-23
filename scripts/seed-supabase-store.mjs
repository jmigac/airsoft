#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
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

function toNicknameLookupKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24)
    .toLowerCase();
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
  const query = params.toString();
  return `${SUPABASE_URL}${pathname}${query ? `?${query}` : ""}`;
}

function normalizeIso(value, fallback = new Date().toISOString()) {
  if (typeof value !== "string") {
    return fallback;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeState(input) {
  if (!input || typeof input !== "object") {
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

  const nowIso = new Date().toISOString();
  const players = Array.isArray(input.players)
    ? input.players
        .filter(
          (player) =>
            player &&
            typeof player === "object" &&
            typeof player.id === "string" &&
            typeof player.sessionId === "string" &&
            typeof player.nickname === "string" &&
            (player.team === "red" || player.team === "blue")
        )
        .map((player) => ({
          id: player.id,
          sessionId: player.sessionId,
          nickname: player.nickname.trim().slice(0, 24),
          team: player.team,
          joinedAt: normalizeIso(player.joinedAt, nowIso),
          lastSeenAt: normalizeIso(player.lastSeenAt, nowIso),
          location:
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
                  updatedAt: normalizeIso(player.location.updatedAt, nowIso)
                }
              : undefined
        }))
    : [];

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
          createdAt: normalizeIso(marker.createdAt, nowIso)
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
            createdAt: normalizeIso(shape.createdAt, nowIso)
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
        .map((signal) => ({
          id: signal.id,
          type: signal.type,
          team: signal.team,
          lat: Number(signal.lat),
          lng: Number(signal.lng),
          createdAt: normalizeIso(signal.createdAt, nowIso),
          expiresAt: normalizeIso(signal.expiresAt, nowIso)
        }))
        .filter((signal) => Date.parse(signal.expiresAt) > nowMs)
    : [];

  const missions = Array.isArray(input.missions)
    ? input.missions
        .filter((mission) => mission && typeof mission === "object" && typeof mission.id === "string")
        .map((mission) => ({
          id: mission.id,
          name: typeof mission.name === "string" && mission.name.trim().length > 0 ? mission.name.trim() : "Mission",
          qrCode: typeof mission.qrCode === "string" ? mission.qrCode.trim() : "",
          mapCenter:
            mission.mapCenter && Number.isFinite(mission.mapCenter.lat) && Number.isFinite(mission.mapCenter.lng)
              ? {
                  lat: Number(mission.mapCenter.lat),
                  lng: Number(mission.mapCenter.lng)
                }
              : undefined,
          timeWindowCET:
            mission.timeWindowCET &&
            typeof mission.timeWindowCET.startsAtCET === "string" &&
            typeof mission.timeWindowCET.endsAtCET === "string"
              ? {
                  startsAtCET: mission.timeWindowCET.startsAtCET,
                  endsAtCET: mission.timeWindowCET.endsAtCET
                }
              : undefined,
          createdAt: normalizeIso(mission.createdAt, nowIso),
          locations: Array.isArray(mission.locations)
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
            : []
        }))
    : [];

  const completions = Array.isArray(input.completions)
    ? input.completions
        .filter(
          (completion) =>
            completion &&
            typeof completion === "object" &&
            typeof completion.id === "string" &&
            typeof completion.missionId === "string" &&
            (completion.team === "red" || completion.team === "blue")
        )
        .map((completion) => ({
          id: completion.id,
          missionId: completion.missionId,
          team: completion.team,
          qrCode: typeof completion.qrCode === "string" ? completion.qrCode.trim() : "",
          completedAt: normalizeIso(completion.completedAt, nowIso)
        }))
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

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${text || response.statusText}`);
  }

  return text ? JSON.parse(text) : null;
}

async function deleteByGameCode(table, gameCode) {
  const params = new URLSearchParams({ game_code: `eq.${gameCode}` });
  await requestJson(buildUrl(`/rest/v1/${table}`, params), {
    method: "DELETE",
    headers: buildHeaders("return=minimal")
  });
}

async function insertRows(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  await requestJson(buildUrl(`/rest/v1/${table}`), {
    method: "POST",
    headers: buildHeaders("return=minimal"),
    body: JSON.stringify(rows)
  });
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

  await requestJson(
    buildUrl(
      "/rest/v1/games",
      new URLSearchParams({
        on_conflict: "code",
        select: "code"
      })
    ),
    {
      method: "POST",
      headers: buildHeaders("resolution=merge-duplicates,return=representation"),
      body: JSON.stringify([
        {
          code: seedGameCode,
          default_map_center_lat: state.defaultMapCenter ? Number(state.defaultMapCenter.lat) : null,
          default_map_center_lng: state.defaultMapCenter ? Number(state.defaultMapCenter.lng) : null
        }
      ])
    }
  );

  await deleteByGameCode("mission_locations", seedGameCode);
  await deleteByGameCode("completions", seedGameCode);
  await deleteByGameCode("missions", seedGameCode);
  await deleteByGameCode("map_shape_points", seedGameCode);
  await deleteByGameCode("map_shapes", seedGameCode);
  await deleteByGameCode("map_markers", seedGameCode);
  await deleteByGameCode("players", seedGameCode);
  await deleteByGameCode("map_signals", seedGameCode);

  const missionRows = state.missions.map((mission) => ({
    id: mission.id,
    game_code: seedGameCode,
    name: mission.name,
    qr_code: mission.qrCode,
    map_center_lat: mission.mapCenter ? Number(mission.mapCenter.lat) : null,
    map_center_lng: mission.mapCenter ? Number(mission.mapCenter.lng) : null,
    time_window_starts_at_cet: mission.timeWindowCET?.startsAtCET ?? null,
    time_window_ends_at_cet: mission.timeWindowCET?.endsAtCET ?? null,
    created_at: mission.createdAt
  }));

  const missionLocationRows = state.missions.flatMap((mission) =>
    mission.locations.map((location, index) => ({
      id: location.id,
      game_code: seedGameCode,
      mission_id: mission.id,
      lat: Number(location.lat),
      lng: Number(location.lng),
      radius: Number(location.radius),
      sort_order: index
    }))
  );

  const completionRows = state.completions.map((completion) => ({
    id: completion.id,
    game_code: seedGameCode,
    mission_id: completion.missionId,
    team: completion.team,
    qr_code: completion.qrCode,
    completed_at: completion.completedAt
  }));

  const playerRows = state.players.map((player) => ({
    id: player.id,
    game_code: seedGameCode,
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

  const markerRows = state.mapMarkers.map((marker) => ({
    id: marker.id,
    game_code: seedGameCode,
    type: marker.type ?? null,
    name: marker.name,
    color: normalizeMarkerColor(marker.color) ?? "#5f676c",
    lat: Number(marker.lat),
    lng: Number(marker.lng),
    created_at: marker.createdAt
  }));

  const shapeRows = state.mapShapes.map((shape) => ({
    id: shape.id,
    game_code: seedGameCode,
    label: shape.label,
    color: normalizeMarkerColor(shape.color) ?? "#5f676c",
    opacity: shape.opacity,
    created_at: shape.createdAt
  }));

  const shapePointRows = state.mapShapes.flatMap((shape) =>
    shape.points.map((point, index) => ({
      shape_id: shape.id,
      game_code: seedGameCode,
      point_index: index,
      lat: Number(point.lat),
      lng: Number(point.lng)
    }))
  );

  const nowMs = Date.now();
  const signalRows = state.mapSignals
    .filter((signal) => Date.parse(signal.expiresAt) > nowMs)
    .map((signal) => ({
      id: signal.id,
      game_code: seedGameCode,
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

  console.log(`Seeded Supabase normalized tables from ${sourcePath} into game ${seedGameCode}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
