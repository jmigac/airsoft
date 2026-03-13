import { NextRequest, NextResponse } from "next/server";
import { findAdminAccountByAuthUserId } from "@/lib/admin-accounts";
import { recordAdminLogin, setAdminCookie } from "@/lib/admin-auth";
import { signInWithSupabasePassword } from "@/lib/supabase-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  try {
    const signedIn = await signInWithSupabasePassword({ email, password });
    const adminAccount = await findAdminAccountByAuthUserId(signedIn.userId);
    if (!adminAccount || !adminAccount.active) {
      return NextResponse.json({ error: "This user is not an active administrator." }, { status: 403 });
    }

    const response = NextResponse.json({
      ok: true,
      admin: {
        email: adminAccount.email,
        role: adminAccount.role
      }
    });

    setAdminCookie(response, {
      userId: adminAccount.authUserId,
      email: adminAccount.email,
      role: adminAccount.role
    });
    await recordAdminLogin(adminAccount.authUserId);

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid credentials." },
      { status: 401 }
    );
  }
}
