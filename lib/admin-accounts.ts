import "server-only";
import { deleteRows, fetchRows, insertRows, patchRows } from "./admin-db";
import { AdminRole } from "./admin-auth";
import { AdminAccountRecord } from "./admin-types";
import { createSupabaseAdminUser } from "./supabase-auth";

type AdminUserRow = {
  id: string;
  auth_user_id: string;
  email: string;
  role: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

function normalizeRole(value: string): AdminRole {
  return value === "global_admin" ? value : "global_admin";
}

function mapAdminUserRow(row: AdminUserRow): AdminAccountRecord {
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    role: normalizeRole(row.role),
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  };
}

export async function listAdminAccounts(): Promise<AdminAccountRecord[]> {
  const rows = await fetchRows<AdminUserRow>(
    "admin_users",
    new URLSearchParams({
      select: "id,auth_user_id,email,role,active,created_at,updated_at,last_login_at",
      order: "created_at.asc"
    })
  );

  return rows.map(mapAdminUserRow);
}

export async function findAdminAccountByAuthUserId(authUserId: string): Promise<AdminAccountRecord | null> {
  const rows = await fetchRows<AdminUserRow>(
    "admin_users",
    new URLSearchParams({
      select: "id,auth_user_id,email,role,active,created_at,updated_at,last_login_at",
      auth_user_id: `eq.${authUserId}`,
      limit: "1"
    })
  );

  return rows[0] ? mapAdminUserRow(rows[0]) : null;
}

export async function createAdminAccount(input: {
  email: string;
  password: string;
  role?: AdminRole;
}) {
  const email = input.email.trim().toLowerCase();
  if (!email) {
    throw new Error("Admin email is required.");
  }

  if (input.password.length < 8) {
    throw new Error("Admin password must be at least 8 characters.");
  }

  const existing = await fetchRows<AdminUserRow>(
    "admin_users",
    new URLSearchParams({
      select: "id,auth_user_id,email,role,active,created_at,updated_at,last_login_at",
      email: `eq.${email}`,
      limit: "1"
    })
  );

  if (existing[0]) {
    throw new Error("An admin account with this email already exists.");
  }

  const createdUser = await createSupabaseAdminUser({
    email,
    password: input.password,
    emailConfirm: true
  });

  const createdRows = await insertRows<
    {
      auth_user_id: string;
      email: string;
      role: AdminRole;
      active: boolean;
    },
    AdminUserRow[]
  >(
    "admin_users",
    [
      {
        auth_user_id: createdUser.userId,
        email: createdUser.email.toLowerCase(),
        role: input.role ?? "global_admin",
        active: true
      }
    ],
    { returning: "representation" }
  );

  if (!createdRows[0]) {
    const fallback = await findAdminAccountByAuthUserId(createdUser.userId);
    if (!fallback) {
      throw new Error("Admin account was created in Supabase Auth but not in admin_users.");
    }
    return fallback;
  }

  return mapAdminUserRow(createdRows[0]);
}

export async function updateAdminAccount(accountId: string, input: { active?: boolean }) {
  const rows = await patchRows<AdminUserRow[]>(
    "admin_users",
    new URLSearchParams({
      select: "id,auth_user_id,email,role,active,created_at,updated_at,last_login_at",
      id: `eq.${accountId}`
    }),
    {
      ...(typeof input.active === "boolean" ? { active: input.active } : {})
    },
    { returning: "representation" }
  );

  if (!rows[0]) {
    throw new Error("Admin account not found.");
  }

  return mapAdminUserRow(rows[0]);
}

export async function deleteAdminAccount(accountId: string) {
  await deleteRows(
    "admin_users",
    new URLSearchParams({
      id: `eq.${accountId}`
    })
  );
}
