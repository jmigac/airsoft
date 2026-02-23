import { Team, TEAMS } from "./types";

const NICKNAME_MAX_LENGTH = 24;

export function normalizeNickname(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, NICKNAME_MAX_LENGTH);
}

export function isValidNickname(value: string) {
  const normalized = normalizeNickname(value);
  return normalized.length >= 2;
}

export function toNicknameLookupKey(value: string) {
  return normalizeNickname(value).toLowerCase();
}

export function isValidTeam(value: string): value is Team {
  return (TEAMS as readonly string[]).includes(value);
}
