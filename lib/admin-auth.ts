import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const ADMIN_COOKIE_NAME = "admin_session";

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET ?? "change-me-in-production";
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD ?? "airsoft-admin";
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

export function validateAdminPassword(password: string) {
  return password === getAdminPassword();
}

export function requestIsAdmin(request: NextRequest, gameCode: string) {
  const payload = verifyToken(request.cookies.get(ADMIN_COOKIE_NAME)?.value);
  return payload === "admin" || payload === `admin:${gameCode}`;
}

export function setAdminCookie(response: NextResponse, gameCode: string) {
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: createToken(`admin:${gameCode}`),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8
  });
}

export function clearAdminCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}
