import { NextRequest, NextResponse } from "next/server";
import { setAdminCookie } from "@/lib/admin-auth";
import { generateGameCode, normalizeGameCode } from "@/lib/game-code";
import { createGame, gameExists } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateGamePayload = {
  gameCode?: string;
};

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

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as CreateGamePayload;

  try {
    const gameCode = await resolveGameCode(payload.gameCode);
    const state = await createGame(gameCode);
    const response = NextResponse.json({ ok: true, gameCode, state });
    setAdminCookie(response, gameCode);
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create game." },
      { status: 400 }
    );
  }
}
