import { NextRequest, NextResponse } from "next/server";
import { listAdminAccounts, updateAdminAccount } from "@/lib/admin-accounts";
import { getAdminSession, requestIsGlobalAdmin } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const session = await getAdminSession(request);
  const params = await context.params;
  const payload = (await request.json().catch(() => ({}))) as { active?: boolean };

  if (typeof payload.active !== "boolean") {
    return NextResponse.json({ error: "The active flag is required." }, { status: 400 });
  }

  if (!payload.active) {
    const accounts = await listAdminAccounts();
    const target = accounts.find((item) => item.id === params.id);
    if (target && session?.userId === target.authUserId) {
      return NextResponse.json({ error: "You cannot deactivate your own administrator account." }, { status: 400 });
    }
  }

  try {
    const account = await updateAdminAccount(params.id, { active: payload.active });

    await recordAdminAction({
      action: payload.active ? "admin_account.reactivated" : "admin_account.deactivated",
      entityType: "admin_account",
      entityId: account.id,
      message: `${payload.active ? "Reactivated" : "Deactivated"} administrator ${account.email}.`,
      metadata: { role: account.role }
    });

    return NextResponse.json({ ok: true, account });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not update admin account." },
      { status: 400 }
    );
  }
}
