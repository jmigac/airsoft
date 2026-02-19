import { normalizeGameCode } from "./game-code";

const GAME_CODE_COOKIE_NAME = "game_code";
const GAME_CODE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

function cookieBaseAttributes() {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  return `Path=/; Max-Age=${GAME_CODE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function readGameCodeCookie() {
  if (typeof document === "undefined") {
    return null;
  }

  const segments = document.cookie.split("; ");
  for (const segment of segments) {
    if (!segment.startsWith(`${GAME_CODE_COOKIE_NAME}=`)) {
      continue;
    }

    const raw = segment.slice(`${GAME_CODE_COOKIE_NAME}=`.length);
    try {
      return normalizeGameCode(decodeURIComponent(raw));
    } catch {
      return normalizeGameCode(raw);
    }
  }

  return null;
}

export function writeGameCodeCookie(gameCode: string) {
  if (typeof document === "undefined") {
    return;
  }

  const normalized = normalizeGameCode(gameCode);
  if (!normalized) {
    return;
  }

  document.cookie = `${GAME_CODE_COOKIE_NAME}=${encodeURIComponent(normalized)}; ${cookieBaseAttributes()}`;
}

export function clearGameCodeCookie() {
  if (typeof document === "undefined") {
    return;
  }

  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${GAME_CODE_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}
