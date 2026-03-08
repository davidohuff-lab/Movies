"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { EMPTY_ADMIN_OVERRIDE, applyAdminOverrides } from "@/lib/client-overrides";
import { PublicDataset, RecommendationResult, UserPreference } from "@/lib/domain";
import { getFullDaySchedule } from "@/lib/search";
import { FIRST_CLASS_TAGS } from "@/lib/tags";
import { formatClock, parseLocalDateTime } from "@/lib/utils";

const PREFERENCES_KEY = "rep-signal-preferences";
const BOOSTS_KEY = "rep-signal-boosts";
const ADMIN_KEY = "rep-signal-admin";

interface CalendarDayViewProps {
  dataset: PublicDataset;
  day: string;
}

interface CalendarTileEntry {
  key: string;
  item: RecommendationResult;
  showtimes: string[];
  tags: string[];
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
      year: "numeric",
      timeZone: "America/New_York"
    }).format(date)
  };
}

function matchesAnyBoostTag(item: RecommendationResult, boosts: string[]): boolean {
  if (boosts.length === 0) {
    return true;
  }
  return boosts.some((boost) => item.tags.includes(boost));
}

function buildCalendarTileEntries(items: RecommendationResult[]): CalendarTileEntry[] {
  const byFilmVenue = new Map<string, CalendarTileEntry>();

  for (const item of items) {
    const key = `${item.film.id}::${item.venue.id}`;
    const screeningTime = formatClock(new Date(item.screening.startAt));
    const filteredTags = Array.from(new Set(item.tags)).filter(
      (tag) => tag.trim().toLowerCase() !== item.venue.name.trim().toLowerCase()
    );

    if (!byFilmVenue.has(key)) {
      byFilmVenue.set(key, {
        key,
        item,
        showtimes: [screeningTime],
        tags: filteredTags
      });
      continue;
    }

    const current = byFilmVenue.get(key)!;
    if (!current.showtimes.includes(screeningTime)) {
      current.showtimes.push(screeningTime);
    }
    current.tags = Array.from(new Set([...current.tags, ...filteredTags]));
  }

  return Array.from(byFilmVenue.values());
}

function getPreferenceThumb(preferences: UserPreference[], filmId: string): "up" | "down" | null {
  return preferences.find((preference) => preference.filmId === filmId)?.thumb ?? null;
}

function applyPreferenceOrdering(entries: CalendarTileEntry[], preferences: UserPreference[]) {
  return entries
    .filter((entry) => getPreferenceThumb(preferences, entry.item.film.id) !== "down")
    .sort((left, right) => {
      const leftThumb = getPreferenceThumb(preferences, left.item.film.id);
      const rightThumb = getPreferenceThumb(preferences, right.item.film.id);
      if (leftThumb === "up" && rightThumb !== "up") {
        return -1;
      }
      if (rightThumb === "up" && leftThumb !== "up") {
        return 1;
      }
      return 0;
    });
}

export function CalendarDayView({ dataset, day }: CalendarDayViewProps) {
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [boosts, setBoosts] = useState<string[]>([]);
  const [adminOverrides, setAdminOverrides] = useState(EMPTY_ADMIN_OVERRIDE);
  const [expandedVenueRows, setExpandedVenueRows] = useState<string[]>([]);

  useEffect(() => {
    const rawPreferences = window.localStorage.getItem(PREFERENCES_KEY);
    const rawBoosts = window.localStorage.getItem(BOOSTS_KEY);
    const rawAdmin = window.localStorage.getItem(ADMIN_KEY);
    setPreferences(rawPreferences ? (JSON.parse(rawPreferences) as UserPreference[]) : []);
    setBoosts(rawBoosts ? (JSON.parse(rawBoosts) as string[]) : []);
    setAdminOverrides(rawAdmin ? { ...EMPTY_ADMIN_OVERRIDE, ...(JSON.parse(rawAdmin) as typeof EMPTY_ADMIN_OVERRIDE) } : EMPTY_ADMIN_OVERRIDE);
  }, []);

  function onVote(filmId: string, thumb: "up" | "down") {
    const next = [
      ...preferences.filter((preference) => preference.filmId !== filmId),
      { filmId, thumb, createdAt: new Date().toISOString() }
    ];
    setPreferences(next);
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  }

  const effectiveDataset = useMemo(() => applyAdminOverrides(dataset, adminOverrides), [adminOverrides, dataset]);
  const dayItems = useMemo(
    () =>
      getFullDaySchedule(effectiveDataset, day, { preferences, liveBoosts: boosts }).filter((item) =>
        matchesAnyBoostTag(item, boosts)
      ),
    [boosts, day, effectiveDataset, preferences]
  );
  const groupedByVenue = useMemo(
    () =>
      Array.from(
        dayItems.reduce((accumulator, item) => {
          const key = item.venue.id;
          if (!accumulator.has(key)) {
            accumulator.set(key, { venueName: item.venue.name, items: [] as RecommendationResult[] });
          }
          accumulator.get(key)!.items.push(item);
          return accumulator;
        }, new Map<string, { venueName: string; items: RecommendationResult[] }>())
      ).sort((left, right) => left[1].venueName.localeCompare(right[1].venueName)),
    [dayItems]
  );
  const dateBlock = formatDateBlock(day);

  return (
    <div className="calendar-stack-layout">
      <section className="calendar-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Full schedule</p>
            <h1>{dateBlock.heading}</h1>
          </div>
          <Link className="chip" href="/calendar">
            Back to calendar
          </Link>
        </div>
        <div className="boost-row">
          {FIRST_CLASS_TAGS.slice(0, 6).map((tag) => (
            <button
              key={tag}
              type="button"
              className={boosts.includes(tag) ? "chip active" : "chip"}
              onClick={() => {
                const next = boosts.includes(tag) ? boosts.filter((current) => current !== tag) : [...boosts, tag];
                setBoosts(next);
                window.localStorage.setItem(BOOSTS_KEY, JSON.stringify(next));
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      <section className="calendar-days-panel">
        <article className="day-row day-row-full">
          <div className="day-rail">
            <p className="day-rail-label">{dateBlock.weekday}</p>
            <h3>{dateBlock.label}</h3>
          </div>
          <div className="day-venue-groups day-venue-groups-open">
            {groupedByVenue.map(([venueId, group]) => {
              const venueTilesAll = applyPreferenceOrdering(buildCalendarTileEntries(group.items), preferences);
              const rowExpanded = expandedVenueRows.includes(venueId);
              const venueTiles = rowExpanded ? venueTilesAll : venueTilesAll.slice(0, 12);
              const hasMoreVenueItems = venueTilesAll.length > 12;
              return (
                <div key={venueId} className="day-venue-row">
                  <div className="day-venue-label">{group.venueName}</div>
                  <div className="day-strip day-strip-venue">
                    {venueTiles.map((entry) => (
                      <article key={entry.key} className="day-tile">
                        <Link href={`/films/${entry.item.film.slug}`} className="day-tile-link">
                          <div className="day-tile-image-wrap">
                            {entry.item.film.posterUrl ? (
                              <img src={entry.item.film.posterUrl} alt={entry.item.film.canonicalTitle} className="day-tile-image" />
                            ) : (
                              <div className="day-tile-image placeholder">No image</div>
                            )}
                          </div>
                          <div className="day-tile-body">
                            <p className="day-tile-title">{entry.item.film.canonicalTitle}</p>
                            <p className="day-tile-meta">{entry.showtimes.join(", ")}</p>
                            {entry.tags.length > 0 ? <p className="day-tile-tags">{entry.tags.slice(0, 3).join(" · ")}</p> : null}
                          </div>
                        </Link>
                        <div className="tile-vote-row">
                          <button type="button" className="tile-vote-button" onClick={() => onVote(entry.item.film.id, "up")}>
                            👍
                          </button>
                          <button type="button" className="tile-vote-button" onClick={() => onVote(entry.item.film.id, "down")}>
                            👎
                          </button>
                        </div>
                      </article>
                    ))}
                    {hasMoreVenueItems ? (
                      <button
                        type="button"
                        className="day-more-button"
                        onClick={() => {
                          setExpandedVenueRows(
                            rowExpanded
                              ? expandedVenueRows.filter((candidate) => candidate !== venueId)
                              : [...expandedVenueRows, venueId]
                          );
                        }}
                      >
                        {rowExpanded ? "Less" : "More"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>
    </div>
  );
}
