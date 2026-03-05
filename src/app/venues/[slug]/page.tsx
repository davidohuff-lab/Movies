import { notFound } from "next/navigation";

import { getPublicDataset } from "@/lib/repository";
import { formatCalendarDate, formatClock } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function VenuePage({ params }: { params: { slug: string } }) {
  const dataset = await getPublicDataset();
  const venue = dataset.venues.find((candidate) => candidate.slug === params.slug);
  if (!venue) {
    notFound();
  }

  const screenings = dataset.screenings
    .filter((screening) => screening.venueId === venue.id)
    .map((screening) => ({
      screening,
      film: dataset.films.find((film) => film.id === screening.filmId)
    }))
    .filter((item): item is { screening: (typeof dataset.screenings)[number]; film: (typeof dataset.films)[number] } => Boolean(item.film));

  return (
    <div className="page-stack">
      <section className="panel">
        <p className="eyebrow">{venue.borough}</p>
        <h1>{venue.name}</h1>
        <p>{venue.address}</p>
        <p>{venue.notes ?? "Curated venue in the NYC repertory network."}</p>
      </section>
      <section className="panel">
        <h2>Upcoming screenings</h2>
        <div className="card-list">
          {screenings.map(({ screening, film }) => (
            <article key={screening.id} className="screening-card static">
              <h3>{film.canonicalTitle}</h3>
              <p>
                {formatCalendarDate(new Date(screening.startAt))} at {formatClock(new Date(screening.startAt))}
              </p>
              <p className="reason">{screening.descriptionRaw}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
