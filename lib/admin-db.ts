import "server-only";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  if (SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_publishable_")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is using a publishable key. Use the Supabase service-role secret key (sb_secret_* or legacy service_role JWT)."
    );
  }
}

function buildUrl(pathname: string, search?: URLSearchParams) {
  assertSupabaseConfig();
  const query = search?.toString();
  return `${SUPABASE_URL}${pathname}${query ? `?${query}` : ""}`;
}

function buildHeaders(options?: { prefer?: string; range?: { from: number; to: number } }) {
  assertSupabaseConfig();
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...(options?.prefer ? { Prefer: options.prefer } : {}),
    ...(options?.range ? { Range: `${options.range.from}-${options.range.to}` } : {})
  };
}

async function parseResponseError(response: Response) {
  const fallback = `${response.status} ${response.statusText}`;
  const raw = await response.text();

  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string; details?: string };
    return parsed.message ?? parsed.error ?? parsed.details ?? raw;
  } catch {
    return raw;
  }
}

async function request(input: string, init: RequestInit) {
  const response = await fetch(input, {
    ...init,
    cache: "no-store"
  });

  if (!response.ok) {
    const details = await parseResponseError(response);
    throw new Error(`Supabase request failed: ${details}`);
  }

  return response;
}

export async function requestJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await request(input, init);

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function fetchRows<T>(table: string, search: URLSearchParams): Promise<T[]> {
  return requestJson<T[]>(buildUrl(`/rest/v1/${table}`, search), {
    method: "GET",
    headers: buildHeaders()
  });
}

export async function fetchRowsWithCount<T>(
  table: string,
  search: URLSearchParams,
  options?: { from?: number; to?: number }
): Promise<{ rows: T[]; count: number }> {
  const response = await request(buildUrl(`/rest/v1/${table}`, search), {
    method: "GET",
    headers: buildHeaders({
      prefer: "count=exact",
      range:
        typeof options?.from === "number" && typeof options?.to === "number"
          ? { from: options.from, to: options.to }
          : undefined
    })
  });

  const contentRange = response.headers.get("content-range");
  const text = await response.text();
  const rows = (text ? JSON.parse(text) : []) as T[];
  const count = Number(contentRange?.split("/")?.[1] ?? rows.length);

  return {
    rows,
    count: Number.isFinite(count) ? count : rows.length
  };
}

export async function insertRows<TInput, TOutput = unknown>(
  table: string,
  rows: TInput[],
  options?: { returning?: "minimal" | "representation" }
) {
  return requestJson<TOutput>(buildUrl(`/rest/v1/${table}`), {
    method: "POST",
    headers: buildHeaders({ prefer: `return=${options?.returning ?? "minimal"}` }),
    body: JSON.stringify(rows)
  });
}

export async function patchRows<T>(
  table: string,
  search: URLSearchParams,
  payload: Record<string, unknown>,
  options?: { returning?: "minimal" | "representation" }
) {
  return requestJson<T>(buildUrl(`/rest/v1/${table}`, search), {
    method: "PATCH",
    headers: buildHeaders({ prefer: `return=${options?.returning ?? "minimal"}` }),
    body: JSON.stringify(payload)
  });
}

export async function deleteRows(
  table: string,
  search: URLSearchParams,
  options?: { returning?: "minimal" | "representation" }
) {
  return requestJson<unknown>(buildUrl(`/rest/v1/${table}`, search), {
    method: "DELETE",
    headers: buildHeaders({ prefer: `return=${options?.returning ?? "minimal"}` })
  });
}
