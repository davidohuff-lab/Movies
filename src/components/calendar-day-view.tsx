"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { FilmTileCard } from "@/components/film-tile-card";
import { ShowtimePickerModal } from "@/components/showtime-picker-modal";
import { EMPTY_ADMIN_OVERRIDE, applyAdminOverrides } from "@/lib/client-overrides";
import { applyCalendarTileOrdering, buildCalendarTileEntries, CalendarTileEntry, getPreferenceThumb, isTilePinned, isTileSaved } from "@/lib/calendar-tiles";
import { readPinnedTileKeys, readSavedScreeningIds, writePinnedTileKeys, writeSavedScreeningIds } from "@/lib/calendar-storage";
import { PublicDataset, UserPreference } from "@/lib/domain";
import { getFullDaySchedule } from "@/lib/search";
import {
  cycleTagFilterMode,
  getIncludedTagFilters,
  matchesTagFilterStates,
  setTagFilterMode,
  TagFilterMode,
  TagFilterStateMap
} from "@/lib/tag-filter-state";
import { FIRST_CLASS_TAGS } from "@/lib/tags";
import { parseLocalDateTime } from "@/lib/utils";

const PREFERENCES_KEY = "rep-signal-preferences";
const ADMIN_KEY = "rep-signal-admin";
const SELECTED_VENUES_KEY = "rep-signal-selected-venues";
const LEGACY_SELECTED_VENUE_KEY = "rep-signal-selected-venue";
const SHOW_ALL_TIMES_KEY = "rep-signal-show-all-times";
const FORMAT_FILTERS = ["Special Event/Talkback", "70MM", "35MM"] as const;
const TAG_FILTERS = FIRST_CLASS_TAGS.filter((tag) => !FORMAT_FILTERS.includes(tag as (typeof FORMAT_FILTERS)[number]));

interface CalendarDayViewProps {
  dataset: PublicDataset;
  day: string;
}

interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
  mode?: TagFilterMode;
}

function parseStoredJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readSelectedVenueIds(): string[] {
  const rawSelectedVenueIds = parseStoredJson<string[]>(window.localStorage.getItem(SELECTED_VENUES_KEY));
  if (rawSelectedVenueIds && Array.isArray(rawSelectedVenueIds)) {
    return rawSelectedVenueIds.filter(Boolean);
  }

  const legacyValue = window.localStorage.getItem(LEGACY_SELECTED_VENUE_KEY);
  if (!legacyValue || legacyValue === "all") {
    return [];
  }

  return [legacyValue];
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

function isWeekdayBeforeSixPm(screeningStartAt: string): boolean {
  const date = new Date(screeningStartAt);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(date);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(date)
  );
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) && hour < 18;
}

function getTagChipClass(mode?: TagFilterMode): string {
  if (mode === "include") {
    return "chip include";
  }
  if (mode === "exclude") {
    return "chip exclude";
  }
  return "chip";
}

function getTagChipLabel(tag: string, mode?: TagFilterMode): string {
  if (mode === "include") {
    return `✓ ${tag}`;
  }
  if (mode === "exclude") {
    return `× ${tag}`;
  }
  return tag;
}

export function CalendarDayView({ dataset, day }: CalendarDayViewProps) {
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [tagFilterStates, setTagFilterStates] = useState<TagFilterStateMap>({});
  const [adminOverrides, setAdminOverrides] = useState(EMPTY_ADMIN_OVERRIDE);
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>([]);
  const [showAllTimes, setShowAllTimes] = useState(false);
  const [savedScreeningIds, setSavedScreeningIds] = useState<string[]>([]);
  const [pinnedTileKeys, setPinnedTileKeys] = useState<string[]>([]);
  const [pendingCalendarEntry, setPendingCalendarEntry] = useState<CalendarTileEntry | null>(null);

  useEffect(() => {
    const rawPreferences = parseStoredJson<UserPreference[]>(window.localStorage.getItem(PREFERENCES_KEY));
    const rawAdmin = parseStoredJson<typeof EMPTY_ADMIN_OVERRIDE>(window.localStorage.getItem(ADMIN_KEY));
    const rawShowAllTimes = window.localStorage.getItem(SHOW_ALL_TIMES_KEY);
    setPreferences(rawPreferences ?? []);
    setAdminOverrides(rawAdmin ? { ...EMPTY_ADMIN_OVERRIDE, ...rawAdmin } : EMPTY_ADMIN_OVERRIDE);
    setSelectedVenueIds(readSelectedVenueIds());
    setShowAllTimes(rawShowAllTimes === "true");
    setSavedScreeningIds(readSavedScreeningIds(window.localStorage));
    setPinnedTileKeys(readPinnedTileKeys(window.localStorage));
  }, []);

  function persistSelectedVenueIds(next: string[]) {
    setSelectedVenueIds(next);
    window.localStorage.setItem(SELECTED_VENUES_KEY, JSON.stringify(next));
    window.localStorage.removeItem(LEGACY_SELECTED_VENUE_KEY);
  }

  function persistSavedIds(next: string[]) {
    setSavedScreeningIds(writeSavedScreeningIds(window.localStorage, next));
  }

  function persistPinnedTileKeys(next: string[]) {
    setPinnedTileKeys(writePinnedTileKeys(window.localStorage, next));
  }

  function toggleTagFilter(tag: string) {
    const nextMode = cycleTagFilterMode(tagFilterStates[tag]);
    setTagFilterStates(setTagFilterMode(tagFilterStates, tag, nextMode));
  }

  function toggleVenueSelection(venueId: string) {
    const next = selectedVenueIds.includes(venueId)
      ? selectedVenueIds.filter((current) => current !== venueId)
      : [...selectedVenueIds, venueId];
    persistSelectedVenueIds(next);
  }

  function onHideToggle(filmId: string) {
    const existing = preferences.find((preference) => preference.filmId === filmId);
    const next: UserPreference[] =
      existing?.thumb === "down"
        ? preferences.filter((preference) => preference.filmId !== filmId)
        : [...preferences.filter((preference) => preference.filmId !== filmId), { filmId, thumb: "down", createdAt: new Date().toISOString() }];
    setPreferences(next);
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  }

  function onPinToggle(entry: CalendarTileEntry) {
    const next = pinnedTileKeys.includes(entry.key)
      ? pinnedTileKeys.filter((candidate) => candidate !== entry.key)
      : [entry.key, ...pinnedTileKeys.filter((candidate) => candidate !== entry.key)];
    persistPinnedTileKeys(next);
  }

  function onSaveToggle(entry: CalendarTileEntry) {
    if (isTileSaved(entry, savedScreeningIds)) {
      persistSavedIds(savedScreeningIds.filter((screeningId) => !entry.screeningIds.includes(screeningId)));
      return;
    }

    if (entry.screenings.length === 1) {
      persistSavedIds([...savedScreeningIds, entry.screeningIds[0]]);
      return;
    }

    setPendingCalendarEntry(entry);
  }

  function onSelectShowtime(screeningId: string) {
    persistSavedIds([...savedScreeningIds, screeningId]);
    setPendingCalendarEntry(null);
  }

  const effectiveDataset = useMemo(() => applyAdminOverrides(dataset, adminOverrides), [adminOverrides, dataset]);
  const includedTagFilters = useMemo(() => getIncludedTagFilters(tagFilterStates), [tagFilterStates]);
  const dayItems = useMemo(
    () =>
      getFullDaySchedule(effectiveDataset, day, { preferences, liveBoosts: includedTagFilters }).filter(
        (item) => matchesTagFilterStates(item.tags, tagFilterStates) && (showAllTimes || !isWeekdayBeforeSixPm(item.screening.startAt))
      ),
    [day, effectiveDataset, includedTagFilters, preferences, showAllTimes, tagFilterStates]
  );
  const groupedByVenue = useMemo(
    () =>
      effectiveDataset.venues
        .filter((venue) => venue.active)
        .map((venue) => {
          const items = dayItems.filter((item) => item.venue.id === venue.id);
          return [venue.id, { venueName: venue.name, venueSlug: venue.slug, venue, items }] as const;
        })
        .filter(([venueId]) => selectedVenueIds.length === 0 || selectedVenueIds.includes(venueId))
        .filter(([, group]) => group.items.length > 0)
        .sort((left, right) => left[1].venueName.localeCompare(right[1].venueName)),
    [dayItems, effectiveDataset.venues, selectedVenueIds]
  );
  const activeVenues = useMemo(
    () =>
      effectiveDataset.venues
        .filter((venue) => venue.active)
        .map((venue) => ({ id: venue.id, name: venue.name, slug: venue.slug }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [effectiveDataset.venues]
  );
  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [
      ...Object.entries(tagFilterStates).map(([tag, mode]) => ({
        key: `tag:${tag}`,
        label: `${mode === "exclude" ? "Hide" : "Show"}: ${tag}`,
        mode,
        onRemove: () => setTagFilterStates(setTagFilterMode(tagFilterStates, tag, undefined))
      }))
    ];
    return chips;
  }, [tagFilterStates]);
  const dateBlock = formatDateBlock(day);

  return (
    <div className="calendar-stack-layout">
      <section className="calendar-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Full schedule</p>
            <h1>{dateBlock.heading}</h1>
          </div>
          <Link className="chip" href="/">
            Back to upcoming films
          </Link>
        </div>
        <div className="filter-group-stack">
          <div className="filter-group">
            <p className="theater-radio-label">Formats</p>
            <div className="theater-radio-list">
              {FORMAT_FILTERS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={getTagChipClass(tagFilterStates[tag])}
                  onClick={() => toggleTagFilter(tag)}
                >
                  {getTagChipLabel(tag, tagFilterStates[tag])}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <p className="theater-radio-label">Tags</p>
            <div className="theater-radio-list">
              {TAG_FILTERS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={getTagChipClass(tagFilterStates[tag])}
                  onClick={() => toggleTagFilter(tag)}
                >
                  {getTagChipLabel(tag, tagFilterStates[tag])}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="time-toggle-row">
          <span className="time-toggle-label">Responsible Adult (No weekdays before 6)</span>
          <button
            type="button"
            role="switch"
            aria-checked={showAllTimes}
            className={`time-toggle ${showAllTimes ? "active" : ""}`}
            onClick={() => {
              const next = !showAllTimes;
              setShowAllTimes(next);
              window.localStorage.setItem(SHOW_ALL_TIMES_KEY, String(next));
            }}
          >
            <span className="time-toggle-thumb" />
          </button>
          <span className="time-toggle-label">Absolute Degenerate (All showtimes)</span>
        </div>
        <div className="theater-radio-row">
          <p className="theater-radio-label">Theater</p>
          <div className="theater-radio-list">
            <label className="theater-radio-item">
              <input
                type="checkbox"
                checked={selectedVenueIds.length === 0}
                onChange={() => persistSelectedVenueIds([])}
              />
              <span>All theaters</span>
            </label>
            {activeVenues.map((venue) => (
              <label key={venue.id} className="theater-radio-item">
                <input
                  type="checkbox"
                  checked={selectedVenueIds.includes(venue.id)}
                  onChange={() => toggleVenueSelection(venue.id)}
                />
                <span>{venue.name}</span>
              </label>
            ))}
          </div>
        </div>
        {activeFilterChips.length > 0 ? (
          <div className="selected-filters-bar">
            <span className="selected-filters-label">Selected</span>
            <div className="selected-filters-list">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className={`selected-filter-chip ${chip.mode === "exclude" ? "exclude" : ""}`.trim()}
                  onClick={chip.onRemove}
                >
                  {chip.label} <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="ghost-button"
              onClick={() => setTagFilterStates({})}
            >
              Clear all
            </button>
          </div>
        ) : null}
      </section>

      <section className="calendar-days-panel">
        <article className="day-row day-row-full">
          <div className="day-rail">
            <p className="day-rail-label">{dateBlock.weekday}</p>
            <h3>{dateBlock.label}</h3>
          </div>
          <div className="day-venue-groups day-venue-groups-open">
            {groupedByVenue.length === 0 ? (
              <div className="day-venue-empty">
                No screenings match the selected theaters, tags, and time filter for {dateBlock.label}.
              </div>
            ) : null}
            {groupedByVenue.map(([venueId, group]) => {
              const venueTiles = applyCalendarTileOrdering(buildCalendarTileEntries(group.items), preferences, pinnedTileKeys);
              return (
                <div key={venueId} className="day-venue-row">
                  <Link href={`/venues/${group.venueSlug}`} className="day-venue-label">
                    {group.venueName}
                  </Link>
                  <div className="day-strip day-strip-venue">
                    {venueTiles.map((entry) => (
                      <FilmTileCard
                        key={entry.key}
                        title={entry.item.film.canonicalTitle}
                        filmSlug={entry.item.film.slug}
                        posterUrl={entry.item.film.posterUrl}
                        venue={group.venue}
                        metaText={entry.showtimes.join(", ")}
                        secondaryText={entry.tags.length > 0 ? entry.tags.slice(0, 3).join(" · ") : undefined}
                        isPinned={isTilePinned(entry, pinnedTileKeys)}
                        isSaved={isTileSaved(entry, savedScreeningIds)}
                        isHidden={getPreferenceThumb(preferences, entry.item.film.id) === "down"}
                        onTogglePin={() => onPinToggle(entry)}
                        onToggleCalendar={() => onSaveToggle(entry)}
                        onToggleHide={() => onHideToggle(entry.item.film.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
      </section>
      <ShowtimePickerModal
        open={Boolean(pendingCalendarEntry)}
        filmTitle={pendingCalendarEntry?.item.film.canonicalTitle ?? ""}
        venueName={pendingCalendarEntry?.item.venue.name ?? ""}
        options={
          pendingCalendarEntry?.screenings.map((screeningItem) => ({
            screeningId: screeningItem.screening.id,
            label: new Intl.DateTimeFormat("en-US", {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
              timeZone: "America/New_York"
            }).format(new Date(screeningItem.screening.startAt))
          })) ?? []
        }
        onClose={() => setPendingCalendarEntry(null)}
        onSelect={onSelectShowtime}
      />
    </div>
  );
}
