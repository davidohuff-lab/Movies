"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { FilmTileCard } from "@/components/film-tile-card";
import { applyCalendarTileOrdering, buildCalendarTileEntries } from "@/lib/calendar-tiles";
import { PublicDataset, RecommendationResult } from "@/lib/domain";
import { getFullDaySchedule } from "@/lib/search";
import { formatEasternDateKey, parseLocalDateTime } from "@/lib/utils";

interface VenueBrowserViewProps {
  dataset: PublicDataset;
}

function getTodayEasternDateKey(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function formatDateBlock(day: string): { weekday: string; label: string; heading: string } {
  const date = parseLocalDateTime(day, "12:00");
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(date),
    label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(date),
    heading: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York"
    }).format(date)
  };
}

export function VenueBrowserView({ dataset }: VenueBrowserViewProps) {
  const todayKey = getTodayEasternDateKey();
  const venuesWithUpcomingScreenings = useMemo(
    () =>
      new Set(
        dataset.screenings
          .filter((screening) => formatEasternDateKey(screening.startAt) >= todayKey)
          .map((screening) => screening.venueId)
      ),
    [dataset.screenings, todayKey]
  );
  const activeVenues = useMemo(
    () =>
      dataset.venues
        .filter((venue) => venue.active)
        .sort((left, right) => {
          const leftHasUpcoming = venuesWithUpcomingScreenings.has(left.id);
          const rightHasUpcoming = venuesWithUpcomingScreenings.has(right.id);
          if (leftHasUpcoming !== rightHasUpcoming) {
            return leftHasUpcoming ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        }),
    [dataset.venues, venuesWithUpcomingScreenings]
  );
  const [selectedVenueId, setSelectedVenueId] = useState(activeVenues[0]?.id ?? "");
  const [theaterPickerOpen, setTheaterPickerOpen] = useState(false);
  const selectedVenue = activeVenues.find((venue) => venue.id === selectedVenueId) ?? activeVenues[0];

  const dayRows = useMemo(() => {
    if (!selectedVenue) {
      return [];
    }

    const days = Array.from(
      new Set(
        dataset.screenings
          .filter((screening) => screening.venueId === selectedVenue.id)
          .map((screening) => formatEasternDateKey(screening.startAt))
          .filter((day) => day >= todayKey)
      )
    ).sort();

    return days
      .map((day) => {
        const dayItems = getFullDaySchedule(dataset, day, { preferences: [], liveBoosts: [] }).filter(
          (item): item is RecommendationResult => item.venue.id === selectedVenue.id
        );
        const entries = applyCalendarTileOrdering(buildCalendarTileEntries(dayItems), [], []);
        return { day, dateBlock: formatDateBlock(day), entries };
      })
      .filter((row) => row.entries.length > 0);
  }, [dataset, selectedVenue, todayKey]);

  if (!selectedVenue) {
    return (
      <section className="panel">
        <h1>By Theater</h1>
        <p className="muted">No active theaters are available yet.</p>
      </section>
    );
  }

  return (
    <div className="venue-browser page-stack">
      <section className="calendar-panel">
        <div className="mobile-home-tabs" aria-label="Primary views">
          <Link href="/" className="mobile-home-tab">
            Upcoming Films
          </Link>
          <Link href="/calendar" className="mobile-home-tab">
            Calendar
          </Link>
          <Link href="/venues" className="mobile-home-tab by-theater-tab active">
            By Theater
          </Link>
        </div>
        <div className="calendar-panel-toolbar">
          <div>
            <p className="eyebrow">By Theater</p>
            <h1>{selectedVenue.name}</h1>
          </div>
          <Link href={`/venues/${selectedVenue.slug}`} className="ghost-button">
            Details
          </Link>
        </div>
        <button
          type="button"
          className="choose-theater-button"
          onClick={() => setTheaterPickerOpen(true)}
        >
          Choose Theater
        </button>
        <div className="venue-picker-strip" aria-label="Choose theater">
          {activeVenues.map((venue) => (
            <button
              key={venue.id}
              type="button"
              className={`venue-picker-chip ${venue.id === selectedVenue.id ? "active" : ""}`}
              onClick={() => setSelectedVenueId(venue.id)}
            >
              {venue.name}
            </button>
          ))}
        </div>
        {theaterPickerOpen ? (
          <div className="showtime-modal-backdrop" role="presentation" onClick={() => setTheaterPickerOpen(false)}>
            <div
              className="showtime-modal theater-picker-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="theater-picker-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="theater-picker-title">Choose Theater</h2>
              <div className="theater-picker-list">
                {activeVenues.map((venue, index) => {
                  const isUnavailable = !venuesWithUpcomingScreenings.has(venue.id);
                  const previousVenue = activeVenues[index - 1];
                  const startsUnavailableGroup =
                    isUnavailable && (!previousVenue || venuesWithUpcomingScreenings.has(previousVenue.id));

                  return (
                    <div key={venue.id} className={startsUnavailableGroup ? "theater-picker-group-start" : undefined}>
                      {startsUnavailableGroup ? <p className="theater-picker-group-label">Showtimes Unavailable</p> : null}
                      <button
                        type="button"
                        className={`theater-picker-option ${venue.id === selectedVenue.id ? "active" : ""}`.trim()}
                        onClick={() => {
                          setSelectedVenueId(venue.id);
                          setTheaterPickerOpen(false);
                        }}
                      >
                        {venue.name}
                      </button>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="ghost-button" onClick={() => setTheaterPickerOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </section>
      <section className="calendar-days-panel">
        {dayRows.length === 0 ? (
          <article className="mobile-program-row">
            <div className="dataset-notice warning">
              <strong>No upcoming screenings.</strong> This theater does not have visible upcoming screenings yet.
            </div>
          </article>
        ) : null}
        {dayRows.map((row) => (
          <article key={row.day} className="mobile-program-row">
            <Link href={`/calendar/${row.day}`} className="mobile-program-heading">
              {row.dateBlock.heading}
            </Link>
            <div className="day-strip mobile-program-strip">
              {row.entries.map((entry) => (
                <FilmTileCard
                  key={entry.key}
                  title={entry.item.film.canonicalTitle}
                  filmSlug={entry.item.film.slug}
                  posterUrl={entry.item.film.posterUrl}
                  venue={selectedVenue}
                  metaText={entry.showtimes.join(", ")}
                  secondaryText={entry.tags.length > 0 ? entry.tags.slice(0, 2).join(" · ") : undefined}
                  isPinned={false}
                  isSaved={false}
                  isHidden={false}
                  onTogglePin={() => undefined}
                  onToggleCalendar={() => undefined}
                  onToggleHide={() => undefined}
                  showPinControl={false}
                  showHideControl={false}
                  showCalendarControl={false}
                />
              ))}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
