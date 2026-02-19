import { MAP_SIGNAL_TYPES, MapSignalType } from "./types";

export const MAP_SIGNAL_DURATION_MS = 2 * 60 * 1000;

export const MAP_SIGNAL_META: Record<MapSignalType, { label: string; shortLabel: string; color: string }> = {
  info: {
    label: "Info",
    shortLabel: "I",
    color: "#1f76d1"
  },
  danger: {
    label: "Danger",
    shortLabel: "D",
    color: "#c53131"
  },
  intel: {
    label: "Intel",
    shortLabel: "T",
    color: "#8a6f1d"
  }
};

export function isMapSignalType(value: string): value is MapSignalType {
  return (MAP_SIGNAL_TYPES as readonly string[]).includes(value);
}
