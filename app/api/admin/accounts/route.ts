import { NextRequest, NextResponse } from "next/server";
import { createAdminAccount, listAdminAccounts } from "@/lib/admin-accounts";
import { requestIsGlobalAdmin } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  try {
    const items = await listAdminAccounts();
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load admin accounts." },
      { status: 400 }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await requestIsGlobalAdmin(request))) {
    return NextResponse.json({ error: "Global admin privileges required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => ({}))) as { email?: string; password?: string };

  try {
    const account = await createAdminAccount({
      email: payload.email ?? "",
      password: payload.password ?? ""
    });

    await recordAdminAction({
      action: "admin_account.created",
      entityType: "admin_account",
      entityId: account.id,
      message: `Created administrator ${account.email}.`,
      metadata: { role: account.role }
    });

    return NextResponse.json({ ok: true, account }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create admin account." },
      { status: 400 }
    );
  }
}
