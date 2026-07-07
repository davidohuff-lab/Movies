import { NextResponse } from "next/server";

import { readNearbyTheaters } from "@/lib/nearby-places-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const theaters = await readNearbyTheaters();
    return NextResponse.json({ theaters });
  } catch {
    return NextResponse.json(
      { message: "Unable to load theaters right now." },
      { status: 500 }
    );
  }
}
