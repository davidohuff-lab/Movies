"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { FilmTileCard } from "@/components/film-tile-card";
import { ShowtimePickerModal } from "@/components/showtime-picker-modal";
import { EMPTY_ADMIN_OVERRIDE, applyAdminOverrides } from "@/lib/client-overrides";
import { applyCalendarTileOrdering, buildCalendarTileEntries, CalendarTileEntry, getPreferenceThumb, isTilePinned, isTileSaved } from "@/lib/calendar-tiles";
import { readPinnedTileKeys, readSavedScreeningIds, writePinnedTileKeys, writeSavedScreeningIds } from "@/lib/calendar-storage";
import { PublicDataset, RecommendationResult, UserPreference } from "@/lib/domain";
import { getFullDaySchedule } from "@/lib/search";
import {
  cycleTagFilterMode,
  getIncludedTagFilters,
  matchesTagFilterStates,
  parseStoredTagFilterStates,
  setTagFilterMode,
  TagFilterMode,
  TagFilterStateMap
} from "@/lib/tag-filter-state";
import { FIRST_CLASS_TAGS } from "@/lib/tags";
import { formatEasternDateKey, parseLocalDateTime } from "@/lib/utils";

const PREFERENCES_KEY = "rep-signal-preferences";
const TAG_FILTER_STATES_KEY = "rep-signal-tag-filter-states";
const LEGACY_BOOSTS_KEY = "rep-signal-boosts";
const ADMIN_KEY = "rep-signal-admin";
const SELECTED_VENUES_KEY = "rep-signal-selected-venues";
const LEGACY_SELECTED_VENUE_KEY = "rep-signal-selected-venue";
const SHOW_ALL_TIMES_KEY = "rep-signal-show-all-times";
const LATE_NIGHT_ONLY_KEY = "rep-signal-late-night-only";

interface CalendarViewProps {
  dataset: PublicDataset;
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

function getTodayEasternDateKey(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function formatDateBlock(day: string): { weekday: string; label: string; monthHeading: string } {
  const date = parseLocalDateTime(day, "12:00");
  return {
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(date),
    label: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(date),
    monthHeading: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(date)
  };
}

function addDays(day: string, amount: number): string {
  const date = parseLocalDateTime(day, "12:00");
  date.setDate(date.getDate() + amount);
  return formatEasternDateKey(date);
}

function formatDateTabLabel(day: string, todayKey: string): string {
  if (day === todayKey) {
    return "Today";
  }
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(parseLocalDateTime(day, "12:00"));
  if (weekday === "Thu") {
    return "Thurs";
  }
  return weekday;
}

function MinimalMarqueeDateButton({
  title,
  sublabel,
  active,
  onClick,
  ariaLabel
}: {
  title: string;
  sublabel: string;
  active: boolean;
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`date-tab minimal-marquee-ticket ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel ?? `${title}, ${sublabel}`}
    >
      <span className="minimal-marquee-title">{title}</span>
      <span className="minimal-marquee-rule" aria-hidden="true" />
      <span className="minimal-marquee-sublabel">{sublabel}</span>
    </button>
  );
}

function TagPickerModal({
  open,
  tags,
  lateNightOnly,
  tagFilterStates,
  onClose,
  onToggleLateNight,
  onToggleTag
}: {
  open: boolean;
  tags: readonly string[];
  lateNightOnly: boolean;
  tagFilterStates: TagFilterStateMap;
  onClose: () => void;
  onToggleLateNight: () => void;
  onToggleTag: (tag: string) => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="showtime-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="showtime-modal tag-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tag-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="tag-picker-title">Tags</h2>
        <div className="tag-picker-grid">
          {tags.map((tag) =>
            tag === "Late Night" ? (
              <button
                key={tag}
                type="button"
                className={`chip ${lateNightOnly ? "include" : ""}`.trim()}
                onClick={onToggleLateNight}
              >
                {lateNightOnly ? "✓ Late Night" : "Late Night"}
              </button>
            ) : (
              <button
                key={tag}
                type="button"
                className={getTagChipClass(tagFilterStates[tag])}
                onClick={() => onToggleTag(tag)}
              >
                {getTagChipLabel(tag, tagFilterStates[tag])}
              </button>
            )
          )}
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function isWeekdayBeforeSixPm(screeningStartAt: string): boolean {
  const date = new Date(screeningStartAt);
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(date);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(date)
  );
  return ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday) && hour < 18;
}

function isLateNightScreening(screeningStartAt: string): boolean {
  const date = new Date(screeningStartAt);
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone: "America/New_York"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour > 22 || (hour === 22 && minute >= 30);
}

const FORMAT_FILTERS = ["Special Event/Talkback", "70MM", "35MM"] as const;
const TAG_FILTERS = FIRST_CLASS_TAGS.filter((tag) => !FORMAT_FILTERS.includes(tag as (typeof FORMAT_FILTERS)[number]));
const QUICK_FILTERS = [...FORMAT_FILTERS, "Late Night"] as const;

function getVenueSortPriority(name: string): number {
  const normalizedName = name.toLowerCase();
  if (normalizedName.includes("metrograph")) {
    return 0;
  }
  if (normalizedName.includes("ifc")) {
    return 1;
  }
  if (normalizedName.includes("film forum")) {
    return 2;
  }
  if (normalizedName.includes("spectacle")) {
    return 3;
  }
  if (normalizedName.includes("roxy")) {
    return 4;
  }
  return 5;
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

function formatTileShowtimes(showtimes: string[]): string {
  const latestShowtimes = showtimes.length > 6 ? showtimes.slice(-6) : showtimes;
  const compactShowtimes = latestShowtimes.map((showtime) =>
    showtime
      .replace(":00", ":00")
      .replace(/\s*AM$/i, "a")
      .replace(/\s*PM$/i, "p")
  );
  return `${compactShowtimes.join(" | ")}${showtimes.length > 6 ? " | (more)" : ""}`;
}

export function CalendarView({ dataset }: CalendarViewProps) {
  const todayKey = getTodayEasternDateKey();
  const otherDateInputRef = useRef<HTMLInputElement | null>(null);
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [tagFilterStates, setTagFilterStates] = useState<TagFilterStateMap>({});
  const [adminOverrides, setAdminOverrides] = useState(EMPTY_ADMIN_OVERRIDE);
  const [selectedVenueIds, setSelectedVenueIds] = useState<string[]>([]);
  const [showAllTimes, setShowAllTimes] = useState(false);
  const [lateNightOnly, setLateNightOnly] = useState(false);
  const [savedScreeningIds, setSavedScreeningIds] = useState<string[]>([]);
  const [pinnedTileKeys, setPinnedTileKeys] = useState<string[]>([]);
  const [pendingCalendarEntry, setPendingCalendarEntry] = useState<CalendarTileEntry | null>(null);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [expandedMobileRowKeys, setExpandedMobileRowKeys] = useState<string[]>([]);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [theatersExpanded, setTheatersExpanded] = useState(false);

  useEffect(() => {
    const rawPreferences = parseStoredJson<UserPreference[]>(window.localStorage.getItem(PREFERENCES_KEY));
    const rawAdmin = parseStoredJson<typeof EMPTY_ADMIN_OVERRIDE>(window.localStorage.getItem(ADMIN_KEY));
    const rawShowAllTimes = window.localStorage.getItem(SHOW_ALL_TIMES_KEY);
    const rawLateNightOnly = window.localStorage.getItem(LATE_NIGHT_ONLY_KEY);
    setPreferences(rawPreferences ?? []);
    setTagFilterStates(
      parseStoredTagFilterStates(
        window.localStorage.getItem(TAG_FILTER_STATES_KEY) ?? window.localStorage.getItem(LEGACY_BOOSTS_KEY),
        FIRST_CLASS_TAGS
      )
    );
    setAdminOverrides(rawAdmin ? { ...EMPTY_ADMIN_OVERRIDE, ...rawAdmin } : EMPTY_ADMIN_OVERRIDE);
    setSelectedVenueIds(readSelectedVenueIds());
    setShowAllTimes(rawShowAllTimes === "true");
    setLateNightOnly(rawLateNightOnly === "true");
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

  function persistTagFilterStates(next: TagFilterStateMap) {
    setTagFilterStates(next);
    window.localStorage.setItem(TAG_FILTER_STATES_KEY, JSON.stringify(next));
  }

  function toggleTagFilter(tag: string) {
    const nextMode = cycleTagFilterMode(tagFilterStates[tag]);
    persistTagFilterStates(setTagFilterMode(tagFilterStates, tag, nextMode));
  }

  function toggleLateNightOnly() {
    const next = !lateNightOnly;
    setLateNightOnly(next);
    window.localStorage.setItem(LATE_NIGHT_ONLY_KEY, String(next));
  }

  function toggleMobileRowExpansion(rowKey: string) {
    setExpandedMobileRowKeys((current) =>
      current.includes(rowKey) ? current.filter((key) => key !== rowKey) : [...current, rowKey]
    );
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
  const days = useMemo(() => {
    const screeningDays = Array.from(
      new Set(
        effectiveDataset.screenings
          .map((screening) => formatEasternDateKey(screening.startAt))
          .filter(Boolean)
      )
    ).sort();

    return screeningDays;
  }, [effectiveDataset.screenings]);
  const fullDay = useMemo(
    () =>
      days.reduce((accumulator, day) => {
        accumulator.set(day, getFullDaySchedule(effectiveDataset, day, { preferences, liveBoosts: includedTagFilters }));
        return accumulator;
      }, new Map<string, RecommendationResult[]>()),
    [days, effectiveDataset, includedTagFilters, preferences]
  );
  const upcomingDays = useMemo(() => days.filter((day) => day >= todayKey), [days, todayKey]);
  const visibleDays = upcomingDays.length > 0 ? upcomingDays : days;
  const selectedDateBlock = formatDateBlock(selectedDay);
  const quickDateTabs = useMemo(() => [todayKey, addDays(todayKey, 1), addDays(todayKey, 2), addDays(todayKey, 3)], [todayKey]);
  const activeVenues = useMemo(
    () =>
      effectiveDataset.venues
        .filter((venue) => venue.active)
        .map((venue) => ({ id: venue.id, name: venue.name, slug: venue.slug }))
        .sort((left, right) => {
          const leftPriority = getVenueSortPriority(left.name);
          const rightPriority = getVenueSortPriority(right.name);
          if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
          }
          return left.name.localeCompare(right.name);
        }),
    [effectiveDataset.venues]
  );
  const selectedDayEntries = useMemo(
    () =>
      applyCalendarTileOrdering(
        buildCalendarTileEntries(
          (fullDay.get(selectedDay) ?? []).filter(
            (item) =>
              matchesTagFilterStates(item.tags, tagFilterStates) &&
              (selectedVenueIds.length === 0 || selectedVenueIds.includes(item.venue.id)) &&
              (showAllTimes || !isWeekdayBeforeSixPm(item.screening.startAt)) &&
              (!lateNightOnly || isLateNightScreening(item.screening.startAt))
          )
        ),
        preferences,
        pinnedTileKeys
      ),
    [fullDay, lateNightOnly, pinnedTileKeys, preferences, selectedDay, selectedVenueIds, showAllTimes, tagFilterStates]
  );
  const mobileRows = useMemo(() => {
    const rows: Array<{ key: string; label: string; href?: string; entries: CalendarTileEntry[] }> = [];
    const specialEventEntries = selectedDayEntries.filter((entry) => entry.tags.includes("Special Event/Talkback"));
    if (specialEventEntries.length > 0) {
      rows.push({ key: "special-events", label: "Event/Talkback", entries: specialEventEntries });
    }

    const lateNightEntries = selectedDayEntries.filter((entry) =>
      entry.screenings.some((screening) => isLateNightScreening(screening.screening.startAt))
    );
    if (lateNightEntries.length > 0) {
      rows.push({ key: "late-night", label: "Late Night", entries: lateNightEntries });
    }

    for (const venue of activeVenues) {
      const entries = selectedDayEntries.filter((entry) => entry.item.venue.id === venue.id);
      if (entries.length > 0) {
        rows.push({ key: venue.id, label: venue.name, href: `/venues/${venue.slug}`, entries });
      }
    }

    return rows;
  }, [activeVenues, selectedDayEntries]);
  const hasOtherSelectedDate = !quickDateTabs.includes(selectedDay);
  const otherDateLabel = hasOtherSelectedDate ? selectedDateBlock.label : "Other";
  const otherDateValue = selectedDay || todayKey;
  const selectedDayHasScreenings = days.includes(selectedDay);
  const emptyMessage = selectedDayHasScreenings
    ? "No visible screenings match the selected filters for this day."
    : "No screenings found for this day yet."
  ;
  const mobileTileProps = {
    showPinControl: false,
    showHideControl: false,
    showCalendarControl: false
  };
  const defaultDayRows = useMemo(
    () =>
      visibleDays
        .map((day) => {
          const dayItems = (fullDay.get(day) ?? []).filter(
            (item) =>
              matchesTagFilterStates(item.tags, tagFilterStates) &&
              (selectedVenueIds.length === 0 || selectedVenueIds.includes(item.venue.id)) &&
              (showAllTimes || !isWeekdayBeforeSixPm(item.screening.startAt)) &&
              (!lateNightOnly || isLateNightScreening(item.screening.startAt))
          );
          const tileEntries = applyCalendarTileOrdering(buildCalendarTileEntries(dayItems), preferences, pinnedTileKeys);
          if (tileEntries.length === 0) {
            return null;
          }

          return {
            day,
            dateBlock: formatDateBlock(day),
            tileEntries,
            topTwelve: tileEntries.slice(0, 12)
          };
        })
        .filter((row): row is { day: string; dateBlock: ReturnType<typeof formatDateBlock>; tileEntries: CalendarTileEntry[]; topTwelve: CalendarTileEntry[] } => Boolean(row)),
    [fullDay, lateNightOnly, pinnedTileKeys, preferences, selectedVenueIds, showAllTimes, tagFilterStates, visibleDays]
  );
  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
    const selectedVenues = activeVenues.filter((venue) => selectedVenueIds.includes(venue.id)).map((venue) => venue.name);
    const chips: ActiveFilterChip[] = [
      ...Object.entries(tagFilterStates).map(([tag, mode]) => ({
        key: `tag:${tag}`,
        label: `${mode === "exclude" ? "Hide" : "Show"}: ${tag}`,
        mode,
        onRemove: () => persistTagFilterStates(setTagFilterMode(tagFilterStates, tag, undefined))
      })),
      ...selectedVenues.map((venueName) => ({ key: `venue:${venueName}`, label: venueName, onRemove: () => {
        const venue = activeVenues.find((candidate) => candidate.name === venueName);
        if (!venue) {
          return;
        }
        persistSelectedVenueIds(selectedVenueIds.filter((current) => current !== venue.id));
      }})),
      ...(showAllTimes
        ? [{
            key: "mode:all",
            label: "All showtimes",
            onRemove: () => {
              setShowAllTimes(false);
              window.localStorage.setItem(SHOW_ALL_TIMES_KEY, "false");
            }
          }]
        : []),
      ...(lateNightOnly
        ? [{
            key: "mode:late-night",
            label: "Late Night",
            onRemove: () => {
              setLateNightOnly(false);
              window.localStorage.setItem(LATE_NIGHT_ONLY_KEY, "false");
            }
          }]
        : [])
    ];
    return chips;
  }, [activeVenues, lateNightOnly, selectedVenueIds, showAllTimes, tagFilterStates]);

  return (
    <div className="calendar-stack-layout">
      <section className="calendar-panel">
        <div className="mobile-home-tabs" aria-label="Primary views">
          <Link href="/" className="mobile-home-tab active">
            <Image
              src="/upcoming-films-ticket-button.svg"
              alt="Upcoming Films"
              width={658}
              height={288}
              className="mobile-home-tab-image"
            />
          </Link>
          <Link href="/calendar" className="mobile-home-tab">
            <Image
              src="/calendar-ticket-button.svg"
              alt="Calendar"
              width={658}
              height={288}
              className="mobile-home-tab-image"
            />
          </Link>
          <Link href="/venues" className="mobile-home-tab by-theater-tab">
            <Image
              src="/by-theater-ticket-button.svg"
              alt="By Theater"
              width={658}
              height={288}
              className="mobile-home-tab-image"
            />
          </Link>
        </div>
        <div className="mobile-date-tabs" aria-label="Choose screening day">
          {quickDateTabs.map((day) => (
            <MinimalMarqueeDateButton
              key={day}
              title={formatDateTabLabel(day, todayKey)}
              sublabel={formatDateBlock(day).label}
              active={selectedDay === day}
              onClick={() => setSelectedDay(day)}
            />
          ))}
          <MinimalMarqueeDateButton
            title={otherDateLabel}
            sublabel={hasOtherSelectedDate ? selectedDateBlock.weekday : "Pick date"}
            active={hasOtherSelectedDate}
            onClick={() => {
              const input = otherDateInputRef.current;
              if (!input) {
                return;
              }
              if (typeof input.showPicker === "function") {
                input.showPicker();
                return;
              }
              input.focus();
            }}
            ariaLabel={hasOtherSelectedDate ? `Other date, ${selectedDateBlock.label}, ${selectedDateBlock.weekday}` : "Pick another day"}
          />
          <input
            ref={otherDateInputRef}
            type="date"
            className="date-picker-input"
            value={otherDateValue}
            onChange={(event) => {
              if (event.target.value) {
                setSelectedDay(event.target.value);
              }
            }}
            aria-label="Pick another day"
          />
        </div>
        <div className="time-toggle-row compact mobile-time-row">
          <div className="time-toggle-copy">
            <span className="time-toggle-label">Responsible Adult</span>
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
            <span className="time-toggle-label">Absolute Degenerate</span>
          </div>
          <button
            type="button"
            className="more-tags-button"
            onClick={() => setTagPickerOpen(true)}
          >
            More Tags
          </button>
        </div>
        {savedScreeningIds.length > 0 ? (
          <div className="saved-inline-bar">
            <span>Saved: {savedScreeningIds.length}</span>
          </div>
        ) : null}
        <div className="filter-group-stack">
          <div className="filter-group">
            <details className="theater-disclosure compact-disclosure" open={tagsExpanded} onToggle={(event) => setTagsExpanded((event.currentTarget as HTMLDetailsElement).open)}>
              <summary className="theater-disclosure-summary">
                <span>Tags</span>
                <span className="theater-disclosure-hint">{tagsExpanded ? "Hide" : "Choose tags"}</span>
              </summary>
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
            </details>
          </div>
          <div className="filter-group">
            <details className="theater-disclosure" open={theatersExpanded} onToggle={(event) => setTheatersExpanded((event.currentTarget as HTMLDetailsElement).open)}>
              <summary className="theater-disclosure-summary">
                <span>{selectedVenueIds.length === 0 ? "All theaters" : `${selectedVenueIds.length} theater${selectedVenueIds.length === 1 ? "" : "s"} selected`}</span>
                <span className="theater-disclosure-hint">{theatersExpanded ? "Hide" : "Choose theaters"}</span>
              </summary>
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
            </details>
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
              onClick={() => {
                persistTagFilterStates({});
                persistSelectedVenueIds([]);
                setShowAllTimes(false);
                setLateNightOnly(false);
                window.localStorage.setItem(SHOW_ALL_TIMES_KEY, "false");
                window.localStorage.setItem(LATE_NIGHT_ONLY_KEY, "false");
              }}
            >
              Clear all
            </button>
          </div>
        ) : null}
      </section>
      <section className="calendar-days-panel">
        <div className="mobile-program-rows">
          {mobileRows.length === 0 ? (
            <article className="mobile-program-row">
              <div className="dataset-notice warning">
                <strong>No visible screenings.</strong> {emptyMessage}
              </div>
            </article>
          ) : null}
          {mobileRows.map((row) => {
            const isTheaterRow = Boolean(row.href);
            const hasMoreCards = row.entries.length > 3;
            const isExpanded = expandedMobileRowKeys.includes(row.key);

            return (
              <article
                key={row.key}
                className={`mobile-program-row ${hasMoreCards ? "has-more" : ""} ${isExpanded ? "expanded" : ""}`.trim()}
              >
                <div className="mobile-program-head">
                  {isTheaterRow && row.href ? (
                    <Link href={row.href} className="mobile-program-heading">
                      {row.label}
                    </Link>
                  ) : (
                    <h2 className="mobile-program-heading">{row.label}</h2>
                  )}
                  {hasMoreCards ? (
                    <button
                      type="button"
                      className="mobile-row-show-all"
                      aria-expanded={isExpanded}
                      onClick={() => toggleMobileRowExpansion(row.key)}
                    >
                      {isExpanded ? "Show Less" : "Show All"}
                    </button>
                  ) : null}
                </div>
                <div className="day-strip mobile-program-strip">
                  {row.entries.map((entry) => (
                    <FilmTileCard
                      key={`${row.key}:${entry.key}`}
                      title={entry.item.film.canonicalTitle}
                      filmSlug={entry.item.film.slug}
                      posterUrl={entry.item.film.posterUrl}
                      venue={entry.item.venue}
                      metaText={isTheaterRow ? undefined : entry.item.venue.name}
                      secondaryText={isTheaterRow && entry.tags.length > 0 ? entry.tags.slice(0, 2).join(" · ") : undefined}
                      showtimeText={formatTileShowtimes(entry.showtimes)}
                      isPinned={isTilePinned(entry, pinnedTileKeys)}
                      isSaved={isTileSaved(entry, savedScreeningIds)}
                      isHidden={getPreferenceThumb(preferences, entry.item.film.id) === "down"}
                      onTogglePin={() => onPinToggle(entry)}
                      onToggleCalendar={() => onSaveToggle(entry)}
                      onToggleHide={() => onHideToggle(entry.item.film.id)}
                      {...mobileTileProps}
                    />
                  ))}
                </div>
                {hasMoreCards && !isExpanded ? <span className="mobile-row-more-indicator" aria-hidden="true" /> : null}
              </article>
            );
          })}
        </div>
        <div className="desktop-day-rows">
        {defaultDayRows.length === 0 ? (
          <article className="day-row">
            <div className="dataset-notice warning">
              <strong>No visible screenings.</strong> The current dataset does not contain screenings for the selected filters and date range.
            </div>
          </article>
        ) : (
          defaultDayRows.map(({ day, dateBlock, tileEntries, topTwelve }) => (
            <article key={day} className="day-row">
              <div className="day-rail">
                <p className="day-rail-label">{dateBlock.weekday}</p>
                <h3>{dateBlock.label}</h3>
                <Link href={`/calendar/${day}`} className="day-view-all">
                  View all
                </Link>
              </div>
              <div className="day-strip">
                {topTwelve.map((entry) => (
                  <FilmTileCard
                    key={entry.key}
                    title={entry.item.film.canonicalTitle}
                    filmSlug={entry.item.film.slug}
                    posterUrl={entry.item.film.posterUrl}
                    venue={entry.item.venue}
                    metaText={`${entry.item.venue.name} · ${entry.showtimes.join(", ")}`}
                    secondaryText={entry.tags.length > 0 ? entry.tags.slice(0, 3).join(" · ") : undefined}
                    isPinned={isTilePinned(entry, pinnedTileKeys)}
                    isSaved={isTileSaved(entry, savedScreeningIds)}
                    isHidden={getPreferenceThumb(preferences, entry.item.film.id) === "down"}
                    onTogglePin={() => onPinToggle(entry)}
                    onToggleCalendar={() => onSaveToggle(entry)}
                    onToggleHide={() => onHideToggle(entry.item.film.id)}
                    calendarTooltip={isTileSaved(entry, savedScreeningIds) ? "Saved" : "Save to Calendar"}
                  />
                ))}
              </div>
            </article>
          ))
        )}
        </div>
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
      <TagPickerModal
        open={tagPickerOpen}
        tags={[...QUICK_FILTERS, ...TAG_FILTERS]}
        lateNightOnly={lateNightOnly}
        tagFilterStates={tagFilterStates}
        onClose={() => setTagPickerOpen(false)}
        onToggleLateNight={toggleLateNightOnly}
        onToggleTag={toggleTagFilter}
      />
    </div>
  );
}
