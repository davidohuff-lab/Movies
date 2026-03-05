import { NextRequest, NextResponse } from "next/server";

import { getAdminCookieName, getAdminSecret } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const payload = await request.json();
  if (payload.secret !== getAdminSecret()) {
    return NextResponse.json({ error: "invalid-secret" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(getAdminCookieName(), "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/"
  });
  return response;
}
