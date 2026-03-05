import { NextResponse } from "next/server";

import { getRegisteredAdapters, getVenueHealth } from "@/lib/adapters/registry";
import { getPublicDataset } from "@/lib/repository";

export async function GET() {
  const dataset = await getPublicDataset();
  const health = await Promise.all(
    dataset.venues
      .filter((venue) => getRegisteredAdapters().some((adapter) => adapter.canHandle(venue)))
      .map(async (venue) => ({
      venue: venue.name,
        ...(await getVenueHealth(venue, dataset.films))
      }))
  );

  return NextResponse.json({ health });
}
