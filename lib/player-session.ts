import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const PLAYER_COOKIE_NAME = "player_session";
const PLAYER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getSessionSecret() {
  return process.env.PLAYER_SESSION_SECRET ?? process.env.ADMIN_SESSION_SECRET ?? "change-me-in-production";
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

function createToken(payload: string) {
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token: string | undefined) {
  if (!token) {
    return null;
  }

  const [payload, providedSig] = token.split(".");
  if (!payload || !providedSig) {
    return null;
  }

  const expectedSig = sign(payload);
  const provided = Buffer.from(providedSig, "utf8");
  const expected = Buffer.from(expectedSig, "utf8");

  if (provided.length !== expected.length) {
    return null;
  }

  if (!timingSafeEqual(provided, expected)) {
    return null;
  }

  return payload;
}

function buildCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge
  };
}

export function getPlayerSessionId(request: NextRequest) {
  return verifyToken(request.cookies.get(PLAYER_COOKIE_NAME)?.value);
}

export function setPlayerSessionCookie(response: NextResponse, sessionId: string) {
  response.cookies.set({
    name: PLAYER_COOKIE_NAME,
    value: createToken(sessionId),
    ...buildCookieOptions(PLAYER_SESSION_MAX_AGE_SECONDS)
  });
}

export function ensurePlayerSessionId(request: NextRequest, response: NextResponse) {
  const existing = getPlayerSessionId(request);
  if (existing) {
    return existing;
  }

  const created = crypto.randomUUID();
  setPlayerSessionCookie(response, created);
  return created;
}
