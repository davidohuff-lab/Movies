import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getAdminCookieName, isAdminCookieAuthorized } from "@/lib/admin-auth";
import { getDatasetCacheStatus, refreshPublicDataset } from "@/lib/repository";

function isCronAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return token === cronSecret;
}

function shouldRunCronNowInNewYork(now: Date): boolean {
  const nyHour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: "America/New_York"
    }).format(now)
  );
  return nyHour === 2;
}

function isManualAuthorized(request: NextRequest): boolean {
  return isAdminCookieAuthorized(request.cookies.get(getAdminCookieName())?.value);
}

function revalidatePublicPages() {
  revalidatePath("/");
  revalidatePath("/calendar");
  revalidatePath("/films/[slug]", "page");
  revalidatePath("/venues/[slug]", "page");
  revalidatePath("/tags/[slug]", "page");
  revalidatePath("/calendar/[date]", "page");
}

export async function POST(request: NextRequest) {
  if (!isManualAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const refreshed = await refreshPublicDataset({ force: true });
  revalidatePublicPages();
  return NextResponse.json({
    ok: true,
    mode: "manual",
    venues: refreshed.venues.length,
    films: refreshed.films.length,
    screenings: refreshed.screenings.length,
    cache: getDatasetCacheStatus()
  });
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  if (!shouldRunCronNowInNewYork(now)) {
    return NextResponse.json({
      ok: true,
      mode: "cron",
      skipped: true,
      reason: "outside-ny-2am-window",
      nowUtc: now.toISOString()
    });
  }

  const refreshed = await refreshPublicDataset({ force: true });
  revalidatePublicPages();
  return NextResponse.json({
    ok: true,
    mode: "cron",
    skipped: false,
    nowUtc: now.toISOString(),
    venues: refreshed.venues.length,
    films: refreshed.films.length,
    screenings: refreshed.screenings.length,
    cache: getDatasetCacheStatus()
  });
}
