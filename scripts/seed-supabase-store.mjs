#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
  /\/+$/,
  ""
);
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const GAME_STATE_ID = 1;

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
    return { missions: [], completions: [] };
  }

  return {
    missions: Array.isArray(input.missions) ? input.missions : [],
    completions: Array.isArray(input.completions) ? input.completions : []
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
        state: { missions: [], completions: [] },
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
      state,
      version: currentVersion + 1
    })
  });

  console.log(`Seeded Supabase game_state from ${sourcePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
