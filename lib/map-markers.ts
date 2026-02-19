import { MAP_MARKER_TYPES, MapMarkerType } from "./types";

export const MAP_MARKER_META: Record<
  MapMarkerType,
  { label: string; shortLabel: string; color: string }
> = {
  village: {
    label: "Village",
    shortLabel: "V",
    color: "#f0a020"
  },
  north_spawn: {
    label: "North Spawn",
    shortLabel: "N",
    color: "#1f5ecf"
  },
  south_spawn: {
    label: "South Spawn",
    shortLabel: "S",
    color: "#2ca34a"
  },
  house: {
    label: "House",
    shortLabel: "H",
    color: "#7c4a2a"
  }
};

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
