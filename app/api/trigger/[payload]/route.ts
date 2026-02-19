import { NextRequest, NextResponse } from "next/server";
import { completeMissionByQrCode } from "@/lib/mission-completion";
import { TEAMS, Team } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function teamFromInput(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase() as Team;
  if (!TEAMS.includes(normalized)) {
    return null;
  }

  return normalized;
}

async function runCompletion(team: Team, payloadFromPath: string) {
  try {
    const result = await completeMissionByQrCode(team, payloadFromPath);
    return NextResponse.json({
      ok: true,
      state: result.state,
      missionId: result.mission.id,
      missionName: result.mission.name,
      team,
      alreadyCompleted: result.alreadyCompleted
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trigger failed";
    const status = message.includes("No quest") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ payload: string }> }
) {
  const params = await context.params;
  const payloadFromPath = decodeURIComponent(params.payload);
  const team = teamFromInput(request.nextUrl.searchParams.get("team"));

  if (!team) {
    return NextResponse.json(
      {
        ok: true,
        message: "Add ?team=red|blue to trigger completion from this endpoint.",
        payload: payloadFromPath,
        validTeams: TEAMS
      },
      { status: 200 }
    );
  }

  return runCompletion(team, payloadFromPath);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ payload: string }> }
) {
  const params = await context.params;
  const payloadFromPath = decodeURIComponent(params.payload);
  const payload = (await request.json().catch(() => ({}))) as { team?: string };
  const team = teamFromInput(payload.team ?? null);

  if (!team) {
    return NextResponse.json(
      { error: "Invalid team. Use one of: red, blue." },
      { status: 400 }
    );
  }

  return runCompletion(team, payloadFromPath);
}
