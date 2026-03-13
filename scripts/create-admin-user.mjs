#!/usr/bin/env node

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function usage() {
  console.error("Usage: node scripts/create-admin-user.mjs <email> <password>");
}

function assertEnv() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing Supabase env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }
}

async function parseError(response) {
  const fallback = `${response.status} ${response.statusText}`;
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text);
    return parsed.msg ?? parsed.error_description ?? parsed.message ?? parsed.error ?? text;
  } catch {
    return text;
  }
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

async function main() {
  const [, , emailArg, passwordArg] = process.argv;
  if (!emailArg || !passwordArg) {
    usage();
    process.exit(1);
  }

  if (passwordArg.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  assertEnv();
  const email = emailArg.trim().toLowerCase();

  const createdUser = await requestJson(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password: passwordArg,
      email_confirm: true
    })
  });

  await requestJson(`${SUPABASE_URL}/rest/v1/admin_users?select=id,email,role,active`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify([
      {
        auth_user_id: createdUser.id,
        email,
        role: "global_admin",
        active: true
      }
    ])
  });

  console.log(`Created global admin ${email} (${createdUser.id}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
