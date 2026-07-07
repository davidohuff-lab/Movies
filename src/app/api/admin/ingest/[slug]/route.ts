import { NextRequest, NextResponse } from "next/server";

import { getAdapterForVenue } from "@/lib/adapters/registry";
import { getAdminCookieName, isAdminCookieAuthorized } from "@/lib/admin-auth";
import { getPublicDataset } from "@/lib/repository";

export async function POST(request: NextRequest, { params }: { params: { slug: string } }) {
  if (!isAdminCookieAuthorized(request.cookies.get(getAdminCookieName())?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dataset = await getPublicDataset();
  const venue = dataset.venues.find((candidate) => candidate.slug === params.slug);
  if (!venue) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }

  const adapter = getAdapterForVenue(venue);
  if (!adapter) {
    return NextResponse.json({ error: "adapter-missing" }, { status: 404 });
  }

  const drafts = await adapter.parseScreenings({ venue, films: dataset.films });
  return NextResponse.json({
    venue: venue.name,
    adapter: adapter.key,
    draftCount: drafts.length,
    lane: adapter.lane
  });
}
