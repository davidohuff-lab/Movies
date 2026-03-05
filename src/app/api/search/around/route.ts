import { NextRequest, NextResponse } from "next/server";

import { getDatasetDefaultDate } from "@/lib/dataset-metadata";
import { getPublicDataset } from "@/lib/repository";
import { searchAroundTime } from "@/lib/search";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dataset = await getPublicDataset();
  const defaultDate = getDatasetDefaultDate(dataset);
  const results = searchAroundTime(
    dataset,
    {
      date: searchParams.get("date") ?? defaultDate,
      time: searchParams.get("time") ?? "20:00",
      windowMinutes: Number(searchParams.get("window") ?? "120"),
      venue: searchParams.get("venue") ?? undefined,
      borough: searchParams.get("borough") ?? undefined,
      excludeDisliked: searchParams.get("excludeDisliked") === "true",
      formatOnly: searchParams.get("formatOnly") === "true",
      newReleaseOnly: searchParams.get("newReleaseOnly") === "true"
    },
    { preferences: [], liveBoosts: searchParams.getAll("boost") }
  );
  return NextResponse.json({ results });
}
