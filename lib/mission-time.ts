import { Mission } from "./types";

const CET_OFFSET_MS = 60 * 60 * 1000;
const CET_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

type MissionWithTimeWindow = Pick<Mission, "timeWindowCET">;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function parseCETDateTime(value: string) {
  const match = CET_DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  const normalized = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() + 1 !== month ||
    normalized.getUTCDate() !== day ||
    normalized.getUTCHours() !== hour ||
    normalized.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return { year, month, day, hour, minute };
}

export function normalizeCETDateTimeInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed.slice(0, 16);
  }

  return trimmed;
}

export function isValidCETDateTime(value: string) {
  return parseCETDateTime(normalizeCETDateTimeInput(value)) !== null;
}

export function formatCETDateTime(value: string) {
  const normalized = normalizeCETDateTimeInput(value);
  if (!isValidCETDateTime(normalized)) {
    return `${value} CET`;
  }

  return `${normalized.replace("T", " ")} CET`;
}

export function getCurrentCETDateTime(now = new Date()) {
  const cet = new Date(now.getTime() + CET_OFFSET_MS);

  return `${cet.getUTCFullYear()}-${pad2(cet.getUTCMonth() + 1)}-${pad2(cet.getUTCDate())}T${pad2(cet.getUTCHours())}:${pad2(cet.getUTCMinutes())}`;
}

export function getMissionTimeWindowStatus(mission: MissionWithTimeWindow, now = new Date()) {
  const window = mission.timeWindowCET;
  if (!window) {
    return "always" as const;
  }

  if (!isValidCETDateTime(window.startsAtCET) || !isValidCETDateTime(window.endsAtCET)) {
    return "always" as const;
  }

  if (window.startsAtCET >= window.endsAtCET) {
    return "always" as const;
  }

  const nowCET = getCurrentCETDateTime(now);
  if (nowCET < window.startsAtCET) {
    return "too_early" as const;
  }

  if (nowCET > window.endsAtCET) {
    return "expired" as const;
  }

  return "active" as const;
}

export function isMissionExpired(mission: MissionWithTimeWindow, now = new Date()) {
  return getMissionTimeWindowStatus(mission, now) === "expired";
}

export function buildMissionOutOfWindowMessage(mission: MissionWithTimeWindow) {
  const window = mission.timeWindowCET;
  if (!window) {
    return "This mission is time-critical and cannot be redeemed at this point.";
  }

  return `This mission is time-critical and cannot be redeemed at this point. Redeem window (CET): ${formatCETDateTime(window.startsAtCET)} - ${formatCETDateTime(window.endsAtCET)}.`;
}
