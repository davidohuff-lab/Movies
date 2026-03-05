import { notFound } from "next/navigation";

import { getPublicDataset } from "@/lib/repository";
import { formatCalendarDate, formatClock } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function TagPage({ params }: { params: { slug: string } }) {
  const dataset = await getPublicDataset();
  const tag = dataset.tags.find((candidate) => candidate.slug === params.slug);
  if (!tag) {
    notFound();
  }

  const screeningIds = dataset.screeningTags
    .filter((screeningTag) => screeningTag.tagId === tag.id)
    .map((screeningTag) => screeningTag.screeningId);
  const screenings = dataset.screenings.filter((screening) => screeningIds.includes(screening.id));

  return (
    <div className="page-stack">
      <section className="panel">
        <p className="eyebrow">Tag page</p>
        <h1>{tag.name}</h1>
      </section>
      <section className="panel">
        <div className="card-list">
          {screenings.map((screening) => {
            const film = dataset.films.find((candidate) => candidate.id === screening.filmId)!;
            const venue = dataset.venues.find((candidate) => candidate.id === screening.venueId)!;
            return (
              <article key={screening.id} className="screening-card static">
                <h3>{film.canonicalTitle}</h3>
                <p>
                  {venue.name} · {formatCalendarDate(new Date(screening.startAt))} ·{" "}
                  {formatClock(new Date(screening.startAt))}
                </p>
                <p className="reason">{screening.descriptionRaw}</p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
