import "server-only";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

type AuthSessionResponse = {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email?: string | null;
  };
};

type AdminCreateUserResponse = {
  id: string;
  email?: string | null;
};

function assertSupabaseUrl() {
  if (!SUPABASE_URL) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL.");
  }
}

function assertServiceRole() {
  assertSupabaseUrl();
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for admin account management.");
  }
}

function assertPublishableKey() {
  assertSupabaseUrl();
  if (!SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "SUPABASE_PUBLISHABLE_KEY is required for admin login."
    );
  }
}

async function parseError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`;
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { msg?: string; error_description?: string; error?: string; message?: string };
    return parsed.msg ?? parsed.error_description ?? parsed.message ?? parsed.error ?? text;
  } catch {
    return text;
  }
}

async function requestJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function signInWithSupabasePassword(input: { email: string; password: string }) {
  assertPublishableKey();
  const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
  const session = await requestJson<AuthSessionResponse>(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password
    })
  });

  if (!session.user?.id || !session.user?.email) {
    throw new Error("Supabase login did not return a valid user.");
  }

  return {
    userId: session.user.id,
    email: session.user.email
  };
}

export async function createSupabaseAdminUser(input: {
  email: string;
  password: string;
  emailConfirm?: boolean;
}) {
  assertServiceRole();
  const url = `${SUPABASE_URL}/auth/v1/admin/users`;
  const created = await requestJson<AdminCreateUserResponse>(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: input.emailConfirm ?? true
    })
  });

  if (!created.id || !created.email) {
    throw new Error("Supabase did not return the created admin user.");
  }

  return {
    userId: created.id,
    email: created.email
  };
}
