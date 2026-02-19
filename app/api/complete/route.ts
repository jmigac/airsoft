import { NextRequest, NextResponse } from "next/server";
import { completeMissionByQrCode } from "@/lib/mission-completion";
import { isValidQuestPayload } from "@/lib/payload";
import { TEAMS, Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { team?: Team; qrCode?: string; payload?: string };
  const team = body.team;
  const qrCode = (body.payload ?? body.qrCode ?? "").trim();

  if (!team || !TEAMS.includes(team)) {
    return NextResponse.json({ error: "Invalid team" }, { status: 400 });
  }

  if (!qrCode) {
    return NextResponse.json({ error: "Quest payload is required" }, { status: 400 });
  }

  if (!isValidQuestPayload(qrCode)) {
    return NextResponse.json(
      { error: "Quest payload must be exactly 6 digits." },
      { status: 400 }
    );
  }

  try {
    const result = await completeMissionByQrCode(team, qrCode);
    return NextResponse.json({
      ok: true,
      state: result.state,
      missionId: result.mission.id,
      missionName: result.mission.name,
      alreadyCompleted: result.alreadyCompleted
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Completion failed";
    const status = message.includes("No quest") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
