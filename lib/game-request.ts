import { NextRequest, NextResponse } from "next/server";
import { normalizeGameCode } from "./game-code";

type GameCodeResult =
  | { ok: true; gameCode: string }
  | { ok: false; response: NextResponse };

export function requireGameCodeFromRequest(request: NextRequest): GameCodeResult {
  const gameCode = normalizeGameCode(request.nextUrl.searchParams.get("game"));
  if (!gameCode) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Valid game code is required in ?game=XXXXXX." },
        { status: 400 }
      )
    };
  }

  return { ok: true, gameCode };
}
