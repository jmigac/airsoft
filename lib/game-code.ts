const GAME_CODE_LENGTH = 6;
const GAME_CODE_REGEX = /^[A-Z0-9]{6}$/;
const GAME_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function sanitizeGameCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, GAME_CODE_LENGTH);
}

export function normalizeGameCode(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const sanitized = sanitizeGameCode(value);
  return GAME_CODE_REGEX.test(sanitized) ? sanitized : null;
}

export function isValidGameCode(value: string) {
  return GAME_CODE_REGEX.test(value);
}

export function generateGameCode() {
  let output = "";
  const randomValues = new Uint32Array(GAME_CODE_LENGTH);
  crypto.getRandomValues(randomValues);

  for (const value of randomValues) {
    output += GAME_CODE_CHARS[value % GAME_CODE_CHARS.length];
  }

  return output;
}
