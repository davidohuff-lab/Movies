import { NextRequest, NextResponse } from "next/server";

import { getPublicDataset } from "@/lib/repository";
import { getThreeSentenceSummary } from "@/lib/summaries";

export async function POST(request: NextRequest) {
  const payload = await request.json();
  const dataset = await getPublicDataset();
  const screening = dataset.screenings.find((candidate) => candidate.id === payload.screeningId);
  if (!screening) {
    return NextResponse.json({ error: "screening-not-found" }, { status: 404 });
  }

  const film = dataset.films.find((candidate) => candidate.id === screening.filmId)!;
  const venue = dataset.venues.find((candidate) => candidate.id === screening.venueId)!;
  const tags = dataset.screeningTags
    .filter((screeningTag) => screeningTag.screeningId === screening.id)
    .map((screeningTag) => dataset.tags.find((tag) => tag.id === screeningTag.tagId)?.name)
    .filter((tag): tag is string => Boolean(tag));

  return NextResponse.json({
    summary: getThreeSentenceSummary({ screening, film, venue, tags }, payload.explanation)
  });
}
