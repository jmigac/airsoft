import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { fetchRows, patchRows } from "./admin-db";

const ADMIN_COOKIE_NAME = "admin_session";

export const ADMIN_ROLES = ["global_admin"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

type AdminSessionCookiePayload = {
  sub: string;
  email: string;
  role: AdminRole;
  exp: number;
};

type AdminUserRow = {
  auth_user_id: string;
  email: string;
  role: string;
  active: boolean;
};

export type AdminSession = {
  userId: string;
  email: string;
  role: AdminRole;
};

function getSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET ?? "change-me-in-production";
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

function createToken(payload: AdminSessionCookiePayload) {
  const serialized = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${serialized}.${sign(serialized)}`;
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

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AdminSessionCookiePayload>;
    if (
      typeof parsed.sub !== "string" ||
      typeof parsed.email !== "string" ||
      parsed.role !== "global_admin" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }

    if (parsed.exp <= Date.now()) {
      return null;
    }

    return parsed as AdminSessionCookiePayload;
  } catch {
    return null;
  }
}

async function readAdminUserByAuthUserId(userId: string): Promise<AdminUserRow | null> {
  const rows = await fetchRows<AdminUserRow>(
    "admin_users",
    new URLSearchParams({
      select: "auth_user_id,email,role,active",
      auth_user_id: `eq.${userId}`,
      limit: "1"
    })
  );

  return rows[0] ?? null;
}

function normalizeRole(value: string): AdminRole | null {
  return value === "global_admin" ? value : null;
}

export async function getAdminSession(request: NextRequest): Promise<AdminSession | null> {
  const parsed = verifyToken(request.cookies.get(ADMIN_COOKIE_NAME)?.value);
  if (!parsed) {
    return null;
  }

  const adminUser = await readAdminUserByAuthUserId(parsed.sub).catch(() => null);
  if (!adminUser || !adminUser.active) {
    return null;
  }

  const role = normalizeRole(adminUser.role);
  if (!role) {
    return null;
  }

  return {
    userId: adminUser.auth_user_id,
    email: adminUser.email,
    role
  };
}

export async function requestIsGlobalAdmin(request: NextRequest) {
  const session = await getAdminSession(request);
  return session?.role === "global_admin";
}

export async function requestIsAdmin(request: NextRequest, _gameCode: string) {
  return requestIsGlobalAdmin(request);
}

export function setAdminCookie(
  response: NextResponse,
  session: {
    userId: string;
    email: string;
    role: AdminRole;
  }
) {
  response.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: createToken({
      sub: session.userId,
      email: session.email,
      role: session.role,
      exp: Date.now() + 1000 * 60 * 60 * 8
    }),
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

export async function recordAdminLogin(userId: string) {
  await patchRows<unknown>(
    "admin_users",
    new URLSearchParams({
      auth_user_id: `eq.${userId}`
    }),
    {
      last_login_at: new Date().toISOString()
    }
  ).catch(() => undefined);
}
