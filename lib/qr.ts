const TRIGGER_ROUTE_PREFIX = "/api/trigger/";
const PIN_REVEAL_ROUTE_PREFIX = "/pin/";

function appendGameCode(path: string, gameCode?: string) {
  if (!gameCode) {
    return path;
  }

  return `${path}?game=${encodeURIComponent(gameCode)}`;
}

export function buildTriggerPath(qrCode: string, gameCode?: string) {
  return appendGameCode(`${TRIGGER_ROUTE_PREFIX}${encodeURIComponent(qrCode)}`, gameCode);
}

export function buildPinRevealPath(payload: string, gameCode?: string) {
  return appendGameCode(`${PIN_REVEAL_ROUTE_PREFIX}${encodeURIComponent(payload)}`, gameCode);
}

export function normalizeQrPayload(rawPayload: string) {
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    return "";
  }

  const fromRawPath = extractQrCodeFromPath(trimmed);
  if (fromRawPath) {
    return fromRawPath;
  }

  const fromPinPath = extractPayloadFromPinPath(trimmed);
  if (fromPinPath) {
    return fromPinPath;
  }

  try {
    const url = new URL(trimmed);
    return extractQrCodeFromPath(url.pathname) ?? extractPayloadFromPinPath(url.pathname) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function extractQrCodeFromPath(pathOrUrl: string) {
  const markerIndex = pathOrUrl.indexOf(TRIGGER_ROUTE_PREFIX);
  if (markerIndex < 0) {
    return null;
  }

  const encoded = pathOrUrl
    .slice(markerIndex + TRIGGER_ROUTE_PREFIX.length)
    .split(/[/?#]/)[0];

  if (!encoded) {
    return null;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function extractPayloadFromPinPath(pathOrUrl: string) {
  const markerIndex = pathOrUrl.indexOf(PIN_REVEAL_ROUTE_PREFIX);
  if (markerIndex < 0) {
    return null;
  }

  const encoded = pathOrUrl
    .slice(markerIndex + PIN_REVEAL_ROUTE_PREFIX.length)
    .split(/[/?#]/)[0];

  if (!encoded) {
    return null;
  }

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}
