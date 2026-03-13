import { MAP_MARKER_TYPES, MapMarkerType } from "./types";

export type MarkerIconToken =
  | "bullseye"
  | "checkpoint"
  | "spawn"
  | "extract"
  | "hazard"
  | "village"
  | "bunker"
  | "house"
  | "intel"
  | "crate";

export const MARKER_ICON_OPTIONS: Array<{
  token: MarkerIconToken;
  label: string;
  glyph: string;
  description: string;
}> = [
  { token: "bullseye", label: "Target", glyph: "◎", description: "Primary objective or mission target" },
  { token: "checkpoint", label: "Checkpoint", glyph: "◇", description: "Control point or route checkpoint" },
  { token: "spawn", label: "Spawn", glyph: "▲", description: "Spawn area or team insertion point" },
  { token: "extract", label: "Extraction", glyph: "✦", description: "Extraction or rally endpoint" },
  { token: "hazard", label: "Hazard", glyph: "☢", description: "Danger area or no-go warning" },
  { token: "village", label: "Village", glyph: "▦", description: "Settlement or built-up area" },
  { token: "bunker", label: "Bunker", glyph: "⬒", description: "Defensive structure or hardpoint" },
  { token: "house", label: "House", glyph: "⌂", description: "Single building or room-clearing target" },
  { token: "intel", label: "Intel", glyph: "✱", description: "Clue, intel, or hidden package" },
  { token: "crate", label: "Crate", glyph: "▣", description: "Supply crate, cache, or equipment drop" }
] as const;

export const MARKER_COLOR_OPTIONS = [
  { value: "#c2410c", label: "Command Amber" },
  { value: "#2563eb", label: "Signal Blue" },
  { value: "#16a34a", label: "Field Green" },
  { value: "#7c3aed", label: "Extraction Violet" },
  { value: "#b91c1c", label: "Danger Red" },
  { value: "#475569", label: "Slate Grey" },
  { value: "#f0a020", label: "Village Gold" },
  { value: "#7c4a2a", label: "Bunker Brown" }
] as const;

export const MAP_MARKER_META: Record<
  MapMarkerType,
  { label: string; shortLabel: string; color: string; description: string; iconToken: MarkerIconToken }
> = {
  village: {
    label: "Village",
    shortLabel: "V",
    color: "#f0a020",
    description: "Named village sector, strongpoint, or built-up area",
    iconToken: "village"
  },
  north_spawn: {
    label: "North Spawn",
    shortLabel: "N",
    color: "#1f5ecf",
    description: "Northern spawn or insertion zone",
    iconToken: "spawn"
  },
  south_spawn: {
    label: "South Spawn",
    shortLabel: "S",
    color: "#2ca34a",
    description: "Southern spawn or fallback entry point",
    iconToken: "spawn"
  },
  house: {
    label: "House",
    shortLabel: "H",
    color: "#7c4a2a",
    description: "Building, house, or CQB objective",
    iconToken: "house"
  },
  objective: {
    label: "Objective",
    shortLabel: "OBJ",
    color: "#c2410c",
    description: "Primary mission objective to attack, defend, or capture",
    iconToken: "bullseye"
  },
  checkpoint: {
    label: "Checkpoint",
    shortLabel: "CP",
    color: "#2563eb",
    description: "Route checkpoint, stage gate, or scoring control point",
    iconToken: "checkpoint"
  },
  spawn_point: {
    label: "Spawn Point",
    shortLabel: "SP",
    color: "#16a34a",
    description: "Spawn point or respawn area",
    iconToken: "spawn"
  },
  extraction_point: {
    label: "Extraction",
    shortLabel: "EX",
    color: "#7c3aed",
    description: "Extraction point, evac route, or end-state location",
    iconToken: "extract"
  },
  danger_zone: {
    label: "Danger Zone",
    shortLabel: "DZ",
    color: "#b91c1c",
    description: "Hazard zone, artillery area, or off-limits section",
    iconToken: "hazard"
  },
  custom: {
    label: "Custom Marker",
    shortLabel: "C",
    color: "#475569",
    description: "Custom marker for scenario-specific map objects",
    iconToken: "crate"
  }
};

export function getMarkerIconOption(value: string | null | undefined) {
  return MARKER_ICON_OPTIONS.find((option) => option.token === value) ?? null;
}

export function getMarkerColorOption(value: string | null | undefined) {
  const normalized = normalizeMarkerColor(value ?? "");
  return MARKER_COLOR_OPTIONS.find((option) => option.value === normalized) ?? null;
}

export function isMapMarkerType(value: string): value is MapMarkerType {
  return (MAP_MARKER_TYPES as readonly string[]).includes(value);
}

export function isValidMarkerColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

export function normalizeMarkerColor(value: string) {
  const trimmed = value.trim();
  if (!isValidMarkerColor(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}
