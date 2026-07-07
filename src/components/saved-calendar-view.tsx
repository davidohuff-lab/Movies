"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { CalendarEventModal } from "@/components/calendar-event-modal";
import { SourceStatusDrawer, SourceStatusSummary } from "@/components/source-status-drawer";
import { buildSharedCalendarHref, parseSharedCalendarParam, readSavedScreeningIds, writeSavedScreeningIds } from "@/lib/calendar-storage";
import { PublicDataset, Screening, Venue } from "@/lib/domain";

interface SavedCalendarViewProps {
  dataset: PublicDataset;
}

type ViewMode = "month" | "week" | "agenda";

interface SavedCalendarEvent {
  screening: Screening;
  film: PublicDataset["films"][number];
  venue: Venue;
  tags: string[];
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EVENT_ACCENTS = ["#b14d2f", "#456246", "#755c2f", "#6d4f5d", "#35607a", "#9d5a2a"];

function dateKeyInEastern(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function atNoonEastern(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00-04:00`);
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
}

function addDays(date: Date, count: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function startOfWeek(date: Date): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const weekday = next.getUTCDay();
  next.setUTCDate(next.getUTCDate() - weekday);
  return next;
}

function formatMonthHeading(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" }).format(date);
}

function formatAgendaHeading(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York"
  }).format(atNoonEastern(dateKey));
}

function venueAccentFor(venueId: string, venues: Venue[]): string {
  const index = venues.findIndex((venue) => venue.id === venueId);
  return EVENT_ACCENTS[(index >= 0 ? index : 0) % EVENT_ACCENTS.length];
}

function eventAccentStyle(accent: string): CSSProperties {
  return { ["--event-accent" as string]: accent };
}

export function SavedCalendarView({ dataset }: SavedCalendarViewProps) {
  const searchParams = useSearchParams();
  const [savedScreeningIds, setSavedScreeningIds] = useState<string[]>([]);
  const [sharedViewScreeningIds, setSharedViewScreeningIds] = useState<string[] | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [visibleDateKey, setVisibleDateKey] = useState(() => dateKeyInEastern(new Date()));
  const [expandedDayKeys, setExpandedDayKeys] = useState<string[]>([]);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [statusDrawerOpen, setStatusDrawerOpen] = useState(false);
  const sharedScreeningIds = useMemo(() => parseSharedCalendarParam(searchParams.get("items")), [searchParams]);

  useEffect(() => {
    setSavedScreeningIds(readSavedScreeningIds(window.localStorage));
  }, []);

  useEffect(() => {
    setSharedViewScreeningIds(sharedScreeningIds.length > 0 ? sharedScreeningIds : null);
  }, [sharedScreeningIds]);

  const effectiveScreeningIds = sharedViewScreeningIds ?? savedScreeningIds;

  function persistSavedScreeningIds(next: string[]) {
    const persisted = writeSavedScreeningIds(window.localStorage, next);
    setSavedScreeningIds(persisted);
  }

  const screeningsById = useMemo(
    () => new Map(dataset.screenings.map((screening) => [screening.id, screening])),
    [dataset.screenings]
  );
  const filmsById = useMemo(() => new Map(dataset.films.map((film) => [film.id, film])), [dataset.films]);
  const venuesById = useMemo(() => new Map(dataset.venues.map((venue) => [venue.id, venue])), [dataset.venues]);
  const tagsById = useMemo(() => new Map(dataset.tags.map((tag) => [tag.id, tag.name])), [dataset.tags]);
  const tagNamesByScreeningId = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const screeningTag of dataset.screeningTags) {
      const tagName = tagsById.get(screeningTag.tagId);
      if (!tagName) {
        continue;
      }
      const current = grouped.get(screeningTag.screeningId) ?? [];
      if (!current.includes(tagName)) {
        current.push(tagName);
      }
      grouped.set(screeningTag.screeningId, current);
    }
    return grouped;
  }, [dataset.screeningTags, tagsById]);

  const events = useMemo(() => {
    const nextEvents: SavedCalendarEvent[] = [];

    for (const screeningId of effectiveScreeningIds) {
      const screening = screeningsById.get(screeningId);
      if (!screening) {
        continue;
      }
      const film = filmsById.get(screening.filmId);
      const venue = venuesById.get(screening.venueId);
      if (!film || !venue) {
        continue;
      }

      nextEvents.push({
        screening,
        film,
        venue,
        tags: (tagNamesByScreeningId.get(screening.id) ?? []).filter(
          (tag) => tag.trim().toLowerCase() !== venue.name.trim().toLowerCase()
        )
      });
    }

    return nextEvents.sort(
      (left, right) => new Date(left.screening.startAt).getTime() - new Date(right.screening.startAt).getTime()
    );
  }, [effectiveScreeningIds, filmsById, screeningsById, tagNamesByScreeningId, venuesById]);

  useEffect(() => {
    const firstEvent = events[0];
    if (!firstEvent) {
      return;
    }
    setVisibleDateKey(dateKeyInEastern(new Date(firstEvent.screening.startAt)));
  }, [events]);

  const groupedByDay = useMemo(() => {
    const grouped = new Map<string, SavedCalendarEvent[]>();
    for (const event of events) {
      const dayKey = dateKeyInEastern(new Date(event.screening.startAt));
      const current = grouped.get(dayKey) ?? [];
      current.push(event);
      grouped.set(dayKey, current);
    }
    return grouped;
  }, [events]);

  const activeEvent = useMemo(
    () => events.find((event) => event.screening.id === activeEventId) ?? null,
    [activeEventId, events]
  );

  const visibleDate = atNoonEastern(visibleDateKey);
  const currentMonthStart = startOfMonth(visibleDate);
  const monthGridStart = startOfWeek(currentMonthStart);
  const monthDays = Array.from({ length: 42 }, (_, index) => {
    const date = addDays(monthGridStart, index);
    const key = dateKeyInEastern(date);
    return {
      key,
      date,
      inCurrentMonth: date.getUTCMonth() === currentMonthStart.getUTCMonth(),
      events: groupedByDay.get(key) ?? []
    };
  });
  const currentWeekStart = startOfWeek(visibleDate);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(currentWeekStart, index);
    const key = dateKeyInEastern(date);
    return { key, date, events: groupedByDay.get(key) ?? [] };
  });

  const shareHref = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    return buildSharedCalendarHref(effectiveScreeningIds, window.location.origin);
  }, [effectiveScreeningIds]);

  async function copyShareLink() {
    if (!shareHref) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareHref);
    } catch {
      window.prompt("Copy this link", shareHref);
    }
  }

  function removeScreening(screeningId: string) {
    if (sharedViewScreeningIds) {
      setSharedViewScreeningIds(sharedViewScreeningIds.filter((current) => current !== screeningId));
    } else {
      persistSavedScreeningIds(savedScreeningIds.filter((current) => current !== screeningId));
    }
    setActiveEventId((current) => (current === screeningId ? null : current));
  }

  function shiftVisibleDate(direction: -1 | 1) {
    if (viewMode === "week") {
      setVisibleDateKey(dateKeyInEastern(addDays(currentWeekStart, direction * 7)));
      return;
    }
    setVisibleDateKey(dateKeyInEastern(new Date(Date.UTC(visibleDate.getUTCFullYear(), visibleDate.getUTCMonth() + direction, 1, 12))));
  }

  function renderEventChip(event: SavedCalendarEvent) {
    const accent = venueAccentFor(event.venue.id, dataset.venues);
    return (
      <button
        key={event.screening.id}
        type="button"
        className="calendar-event-chip"
        style={eventAccentStyle(accent)}
        onClick={() => setActiveEventId(event.screening.id)}
      >
        <span className="calendar-event-chip-time">
          {new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
            timeZone: "America/New_York"
          })
            .format(new Date(event.screening.startAt))
            .replace(":00", "")
            .toLowerCase()}
        </span>
        <span className="calendar-event-chip-title">{event.film.canonicalTitle}</span>
      </button>
    );
  }

  return (
    <div className="calendar-stack-layout">
      <section className="calendar-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">{sharedViewScreeningIds ? "Shared selection" : "Selected screenings"}</p>
            <h1>Calendar</h1>
          </div>
          <div className="saved-calendar-actions">
            <button type="button" className="chip" onClick={copyShareLink} disabled={effectiveScreeningIds.length === 0}>
              Copy share link
            </button>
            {sharedViewScreeningIds === null ? (
              <button
                type="button"
                className="chip"
                onClick={() => persistSavedScreeningIds([])}
                disabled={savedScreeningIds.length === 0}
              >
                Clear calendar
              </button>
            ) : null}
            <Link href="/" className="chip">
              Back to upcoming films
            </Link>
          </div>
        </div>
        <div className="calendar-topline-row">
          <div className="boost-row">
            <button type="button" className={viewMode === "month" ? "chip active" : "chip"} onClick={() => setViewMode("month")}>
              Month
            </button>
            <button type="button" className={viewMode === "week" ? "chip active" : "chip"} onClick={() => setViewMode("week")}>
              Week
            </button>
            <button type="button" className={viewMode === "agenda" ? "chip active" : "chip"} onClick={() => setViewMode("agenda")}>
              Agenda
            </button>
          </div>
          <SourceStatusSummary dataset={dataset} onOpen={() => setStatusDrawerOpen(true)} />
        </div>
        <div className="dataset-notice">
          {sharedViewScreeningIds
            ? "This view is being driven by a share link."
            : "This page is populated by the screenings you saved with the calendar action on Upcoming Films."}
        </div>
      </section>
      <section className="calendar-panel planner-panel">
        <div className="planner-header">
          <div>
            <p className="eyebrow">Planner view</p>
            <h2>{viewMode === "week" ? `Week of ${formatAgendaHeading(dateKeyInEastern(currentWeekStart))}` : formatMonthHeading(visibleDate)}</h2>
          </div>
          <div className="saved-calendar-actions">
            <button type="button" className="chip" onClick={() => shiftVisibleDate(-1)}>
              Prev
            </button>
            <button type="button" className="chip" onClick={() => setVisibleDateKey(dateKeyInEastern(new Date()))}>
              Today
            </button>
            <button type="button" className="chip" onClick={() => shiftVisibleDate(1)}>
              Next
            </button>
          </div>
        </div>

        {events.length === 0 ? (
          <div className="dataset-notice warning">
            <strong>No saved screenings.</strong> Save screenings from Upcoming Films to populate this calendar.
          </div>
        ) : null}

        {events.length > 0 && viewMode === "month" ? (
          <div className="calendar-month-wrap">
            <div className="calendar-month-head">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="calendar-head">
                  {label}
                </div>
              ))}
            </div>
            <div className="calendar-month-grid">
              {monthDays.map((day) => {
                const isExpanded = expandedDayKeys.includes(day.key);
                const visibleEvents = isExpanded ? day.events : day.events.slice(0, 3);
                return (
                  <article key={day.key} className={`calendar-day-cell ${day.inCurrentMonth ? "" : "muted-cell"}`}>
                    <div className="calendar-day-number">{Number(day.key.slice(8, 10))}</div>
                    <div className="calendar-day-events">
                      {visibleEvents.map(renderEventChip)}
                      {day.events.length > 3 && !isExpanded ? (
                        <button
                          type="button"
                          className="calendar-more-link"
                          onClick={() => setExpandedDayKeys((current) => [...current, day.key])}
                        >
                          +{day.events.length - 3} more
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        {events.length > 0 && viewMode === "week" ? (
          <div className="calendar-week-grid">
            {weekDays.map((day) => (
              <article key={day.key} className="calendar-week-column">
                <div className="calendar-week-column-head">
                  <span>{WEEKDAY_LABELS[day.date.getUTCDay()]}</span>
                  <strong>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(day.date)}</strong>
                </div>
                <div className="calendar-week-column-body">
                  {day.events.length === 0 ? <p className="muted">No events</p> : day.events.map(renderEventChip)}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {events.length > 0 && viewMode === "agenda" ? (
          <div className="calendar-agenda">
            {Array.from(groupedByDay.entries()).map(([dayKey, dayEvents]) => (
              <section key={dayKey} className="agenda-day-group">
                <div className="agenda-day-head">
                  <p className="eyebrow">Date</p>
                  <h3>{formatAgendaHeading(dayKey)}</h3>
                </div>
                <div className="agenda-event-list">
                  {dayEvents.map((event) => (
                    <button
                      key={event.screening.id}
                      type="button"
                      className="agenda-event-card"
                      onClick={() => setActiveEventId(event.screening.id)}
                    >
                      <div>
                        <strong>{event.film.canonicalTitle}</strong>
                        <p className="muted">
                          {new Intl.DateTimeFormat("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                            timeZone: "America/New_York"
                          }).format(new Date(event.screening.startAt))}{" "}
                          · {event.venue.name}
                        </p>
                      </div>
                      <div className="agenda-event-tags">
                        {event.tags.slice(0, 3).map((tag) => (
                          <span key={tag} className="badge weak">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </section>
      <CalendarEventModal
        open={Boolean(activeEvent)}
        film={activeEvent?.film ?? null}
        screening={activeEvent?.screening ?? null}
        venue={activeEvent?.venue ?? null}
        tags={activeEvent?.tags ?? []}
        onClose={() => setActiveEventId(null)}
        onRemove={() => (activeEvent ? removeScreening(activeEvent.screening.id) : undefined)}
      />
      <SourceStatusDrawer dataset={dataset} open={statusDrawerOpen} onClose={() => setStatusDrawerOpen(false)} />
    </div>
  );
}
