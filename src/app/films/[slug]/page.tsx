import { notFound } from "next/navigation";

import { PosterImage } from "@/components/poster-image";
import { ScreeningSaveButton } from "@/components/screening-save-button";
import { getPublicDataset } from "@/lib/repository";
import {
  extractScreeningDescriptionCandidate,
  extractScreeningPayloadMetadata,
  enrichFilmDetailFromSourcePage
} from "@/lib/source-page-enrichment";
import { hasWeakSynopsis } from "@/lib/rottentomatoes";
import { getThreeSentenceSummary } from "@/lib/summaries";
import { getVenueFallbackImageUrl, shouldUseVenueImageOnly } from "@/lib/venue-fallback-images";
import { formatCalendarDate, formatClock } from "@/lib/utils";

export const revalidate = 86400;
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
  const payloadMetadata = sortedScreenings
    .map((screening) => extractScreeningPayloadMetadata(screening))
    .reduce<{
      title?: string;
      description?: string;
      releaseYear?: number;
      runtimeMinutes?: number;
      directors: string[];
    }>(
      (accumulator, current) => ({
        title: accumulator.title ?? current.title,
        description: accumulator.description ?? current.description,
        releaseYear: accumulator.releaseYear ?? current.releaseYear,
        runtimeMinutes: accumulator.runtimeMinutes ?? current.runtimeMinutes,
        directors: accumulator.directors.length > 0 ? accumulator.directors : current.directors
      }),
      { directors: [] }
    );
  const sourceEnrichment = await enrichFilmDetailFromSourcePage(film.canonicalTitle, sortedScreenings);
  const venueFallbackImageUrl = venue ? getVenueFallbackImageUrl(venue) : null;
  const displayPosterUrl = venue && shouldUseVenueImageOnly(venue) ? null : sourceEnrichment.posterUrl ?? film.posterUrl ?? null;
  const descriptionScreening = primaryScreening ?? sortedScreenings[0];
  const candidateDescription =
    sourceEnrichment.description ??
    payloadMetadata.description ??
    (descriptionScreening ? extractScreeningDescriptionCandidate(descriptionScreening) : undefined) ??
    film.synopsis ??
    undefined;
  const displayReleaseYear = film.releaseYear ?? payloadMetadata.releaseYear;
  const displayRuntimeMinutes = film.runtimeMinutes ?? payloadMetadata.runtimeMinutes;
  const displayDirectors = film.directors.length > 0 ? film.directors : payloadMetadata.directors;
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
  const displayDescription = hasWeakSynopsis(candidateDescription) ? summary : candidateDescription ?? summary;

  return (
    <div className="page-stack">
      <section className="panel">
        <p className="eyebrow">Film detail</p>
        <h1>
          {film.canonicalTitle} · {primaryVenueName}
        </h1>
        {displayPosterUrl ? (
          <div className="detail-poster-wrap">
            <PosterImage
              primaryUrl={displayPosterUrl}
              fallbackUrl={venueFallbackImageUrl}
              alt={`${film.canonicalTitle} poster`}
              className="detail-poster"
              width={960}
              height={640}
              sizes="(max-width: 768px) 100vw, 960px"
            />
          </div>
        ) : venueFallbackImageUrl ? (
          <div className="detail-poster-wrap">
            <PosterImage
              primaryUrl={null}
              fallbackUrl={venueFallbackImageUrl}
              alt={`${primaryVenueName} logo`}
              className="detail-poster"
              width={960}
              height={640}
              sizes="(max-width: 768px) 100vw, 960px"
            />
          </div>
        ) : null}
        {primaryScreening?.sourceUrl ? (
          <p>
            <a href={primaryScreening.sourceUrl} target="_blank" rel="noreferrer" className="detail-link">
              Theater page with film
            </a>
          </p>
        ) : null}
        {venueNames.length > 1 ? <p className="muted">Also playing at: {venueNames.slice(1).join(", ")}</p> : null}
        <p>
          {displayReleaseYear ?? "Year unknown"} · {displayRuntimeMinutes ?? "?"} min ·{" "}
          {displayDirectors.length > 0 ? displayDirectors.join(", ") : "Director unknown"}
        </p>
        <p>{displayDescription ?? summary}</p>
      </section>
      <section className="panel">
        <h2>Screenings</h2>
        <div className="card-list">
          {sortedScreenings.map((screening) => {
            const screeningVenue = dataset.venues.find((candidate) => candidate.id === screening.venueId)!;
            const screeningReason =
              (hasWeakSynopsis(extractScreeningPayloadMetadata(screening).description)
                ? undefined
                : extractScreeningPayloadMetadata(screening).description) ??
              (hasWeakSynopsis(extractScreeningDescriptionCandidate(screening))
                ? undefined
                : extractScreeningDescriptionCandidate(screening)) ??
              undefined;
            return (
              <article key={screening.id} className="screening-card static">
                <div className="screening-card-head">
                  <h3>{screeningVenue.name}</h3>
                  <ScreeningSaveButton screeningId={screening.id} />
                </div>
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
                {screeningReason ? <p className="reason">{screeningReason}</p> : null}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
