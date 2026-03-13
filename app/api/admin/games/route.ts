import { NextRequest, NextResponse } from "next/server";
import { requestIsGlobalAdmin } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";
import { listAdminGames, updateAdminGameRecord } from "@/lib/admin-store";
import { generateGameCode, normalizeGameCode } from "@/lib/game-code";
import { createGame, gameExists } from "@/lib/store";
import { AdminGameMutationInput } from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveGameCode(preferredCode?: string) {
  const normalizedPreferred = normalizeGameCode(preferredCode ?? null);
  if (normalizedPreferred) {
    const exists = await gameExists(normalizedPreferred);
    if (exists) {
      throw new Error("Game code already exists.");
    }
    return normalizedPreferred;
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = generateGameCode();
    const exists = await gameExists(candidate);
    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Could not generate a unique game code. Please retry.");
}

export async function GET(request: NextRequest) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? "10");
  const query = request.nextUrl.searchParams.get("query") ?? undefined;
  const status = request.nextUrl.searchParams.get("status") ?? undefined;
  const sortParam = request.nextUrl.searchParams.get("sort");
  const directionParam = request.nextUrl.searchParams.get("direction");

  try {
    const result = await listAdminGames({
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 10,
      query,
      status,
      sort: sortParam === "name" || sortParam === "status" || sortParam === "player_count" ? sortParam : "created_at",
      direction: directionParam === "asc" ? "asc" : "desc"
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load games." },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as Partial<AdminGameMutationInput> & { code?: string };
  const name = payload.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "Game name is required." }, { status: 400 });
  }

  const status = payload.status ?? "active";

  try {
    const gameCode = await resolveGameCode(payload.code);
    await createGame(gameCode);
    const game = await updateAdminGameRecord(gameCode, {
      name,
      description: payload.description,
      status,
      mapReference: payload.mapReference,
      creationMetadata: payload.creationMetadata
    });

    await recordAdminAction({
      action: "game.created",
      entityType: "game",
      entityId: game.code,
      gameCode: game.code,
      message: `Created game ${game.name}.`,
      metadata: { status: game.status }
    });

    return NextResponse.json({ ok: true, game }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create game." },
      { status: 400 }
    );
  }
}
