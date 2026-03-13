import { NextRequest, NextResponse } from "next/server";
import { normalizeGameCode } from "@/lib/game-code";
import { completeIntelRecoveryMission } from "@/lib/mission-completion";
import { getPlayerSessionId } from "@/lib/player-session";
import { filterStateForTeam } from "@/lib/state-visibility";
import { readState } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILES = 4;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

async function fileToDataUrl(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${bytes.toString("base64")}`;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const gameCode = normalizeGameCode(String(formData.get("gameCode") ?? ""));
  const missionId = String(formData.get("missionId") ?? "").trim();

  if (!gameCode) {
    return NextResponse.json({ error: "Valid game code is required." }, { status: 400 });
  }

  if (!missionId) {
    return NextResponse.json({ error: "Mission is required." }, { status: 400 });
  }

  const sessionId = getPlayerSessionId(request);
  if (!sessionId) {
    return NextResponse.json({ error: "Join a team first." }, { status: 401 });
  }

  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (files.length === 0) {
    return NextResponse.json({ error: "At least one image is required." }, { status: 400 });
  }

  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Upload up to ${MAX_FILES} images at once.` }, { status: 400 });
  }

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Only image uploads are allowed." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Each image must be smaller than ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB.` },
        { status: 400 }
      );
    }
  }

  try {
    const current = await readState(gameCode);
    const player = (current.players ?? []).find((entry) => entry.sessionId === sessionId);
    if (!player) {
      return NextResponse.json({ error: "Join a team first." }, { status: 401 });
    }

    const uploads = await Promise.all(
      files.map(async (file) => ({
        filename: file.name || "intel-image",
        contentType: file.type || "application/octet-stream",
        dataUrl: await fileToDataUrl(file)
      }))
    );

    const result = await completeIntelRecoveryMission(gameCode, player.team, missionId, uploads);

    return NextResponse.json({
      ok: true,
      state: filterStateForTeam(result.state, player.team),
      missionId: result.mission.id,
      missionName: result.mission.name,
      alreadyCompleted: result.alreadyCompleted
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Intel upload failed.";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
