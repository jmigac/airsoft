import { NextRequest, NextResponse } from "next/server";
import { requestIsGlobalAdmin } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";
import { AdminGameMutationInput } from "@/lib/admin-types";
import { deleteAdminGameRecord, getAdminGameDetail, updateAdminGameRecord } from "@/lib/admin-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const params = await context.params;

  try {
    const detail = await getAdminGameDetail(params.code);
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load game detail.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const params = await context.params;
  const payload = (await request.json().catch(() => ({}))) as Partial<AdminGameMutationInput>;
  const name = payload.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "Game name is required." }, { status: 400 });
  }

  try {
    const game = await updateAdminGameRecord(params.code, {
      name,
      description: payload.description,
      status: payload.status ?? "active",
      mapReference: payload.mapReference,
      creationMetadata: payload.creationMetadata
    });

    await recordAdminAction({
      action: "game.updated",
      entityType: "game",
      entityId: game.code,
      gameCode: game.code,
      message: `Updated game ${game.name}.`,
      metadata: { status: game.status }
    });

    return NextResponse.json({ ok: true, game });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update game.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ code: string }> }
) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const params = await context.params;

  try {
    const detail = await getAdminGameDetail(params.code);
    await recordAdminAction({
      action: "game.deleted",
      entityType: "game",
      entityId: detail.game.code,
      gameCode: detail.game.code,
      message: `Deleted game ${detail.game.name}.`,
      metadata: { players: detail.game.playerCount, markers: detail.game.markerCount }
    });
    await deleteAdminGameRecord(params.code);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete game.";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 400 });
  }
}
