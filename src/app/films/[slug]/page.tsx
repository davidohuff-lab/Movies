import { notFound } from "next/navigation";

import { getPublicDataset } from "@/lib/repository";
import { getThreeSentenceSummary } from "@/lib/summaries";
import { formatCalendarDate, formatClock } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function FilmPage({ params }: { params: { slug: string } }) {
  const dataset = await getPublicDataset();
  const film = dataset.films.find((candidate) => candidate.slug === params.slug);
  if (!film) {
    notFound();
  }

  const screenings = dataset.screenings.filter((screening) => screening.filmId === film.id);
  const sortedScreenings = [...screenings].sort(
    (left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime()
  );
  const primaryScreening = screenings[0];
  const venue = primaryScreening
    ? dataset.venues.find((candidate) => candidate.id === primaryScreening.venueId)!
    : null;
  const primaryVenueName = venue?.name ?? "Venue unknown";
  const venueNames = Array.from(
    new Set(
      sortedScreenings
        .map((screening) => dataset.venues.find((candidate) => candidate.id === screening.venueId)?.name)
        .filter((name): name is string => Boolean(name))
    )
  );
  const summary =
    primaryScreening && venue
      ? getThreeSentenceSummary({
          screening: primaryScreening,
          film,
          venue,
          tags: dataset.screeningTags
            .filter((screeningTag) => screeningTag.screeningId === primaryScreening.id)
            .map((screeningTag) => dataset.tags.find((tag) => tag.id === screeningTag.tagId)?.name)
            .filter((tag): tag is string => Boolean(tag))
        })
      : film.synopsis ?? "Summary unavailable.";

  return (
    <div className="page-stack">
      <section className="panel">
        <p className="eyebrow">Film detail</p>
        <h1>
          {film.canonicalTitle} · {primaryVenueName}
        </h1>
        {primaryScreening?.sourceUrl ? (
          <p>
            <a href={primaryScreening.sourceUrl} target="_blank" rel="noreferrer" className="detail-link">
              Theater page with film
            </a>
          </p>
        ) : null}
        {venueNames.length > 1 ? <p className="muted">Also playing at: {venueNames.slice(1).join(", ")}</p> : null}
        <p>
          {film.releaseYear ?? "Year unknown"} · {film.runtimeMinutes ?? "?"} min ·{" "}
          {film.directors.length > 0 ? film.directors.join(", ") : "Director unknown"}
        </p>
        <p>{summary}</p>
      </section>
      <section className="panel">
        <h2>Screenings</h2>
        <div className="card-list">
          {sortedScreenings.map((screening) => {
            const screeningVenue = dataset.venues.find((candidate) => candidate.id === screening.venueId)!;
            return (
              <article key={screening.id} className="screening-card static">
                <h3>{screeningVenue.name}</h3>
                <p>
                  {formatCalendarDate(new Date(screening.startAt))} at {formatClock(new Date(screening.startAt))}
                </p>
                {screening.sourceUrl ? (
                  <p>
                    <a href={screening.sourceUrl} target="_blank" rel="noreferrer" className="detail-link">
                      Theater page with film
                    </a>
                  </p>
                ) : null}
                <p className="reason">{screening.descriptionRaw}</p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
