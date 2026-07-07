"use client";

import { useEffect, useMemo, useRef } from "react";

import { buildGoogleCalendarUrl, buildIcsContent, getEventEndDate } from "@/lib/calendar-export";
import { Film, Screening, Venue } from "@/lib/domain";

interface CalendarEventModalProps {
  open: boolean;
  film: Film | null;
  screening: Screening | null;
  venue: Venue | null;
  tags: string[];
  onClose: () => void;
  onRemove: () => void;
}

export function CalendarEventModal({ open, film, screening, venue, tags, onClose, onRemove }: CalendarEventModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      return;
    }

    const dialog = dialogRef.current;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    );
    focusable[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) {
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? focusable.indexOf(active) : -1;
      if (event.shiftKey && currentIndex <= 0) {
        event.preventDefault();
        focusable[focusable.length - 1]?.focus();
      } else if (!event.shiftKey && currentIndex === focusable.length - 1) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const googleUrl = useMemo(() => {
    if (!film || !screening || !venue) {
      return "";
    }
    return buildGoogleCalendarUrl({ film, screening, venue });
  }, [film, screening, venue]);

  if (!open || !film || !screening || !venue) {
    return null;
  }

  const resolvedFilm = film;
  const resolvedScreening = screening;
  const resolvedVenue = venue;
  const start = new Date(resolvedScreening.startAt);
  const { end } = getEventEndDate(resolvedScreening, resolvedFilm);

  return (
    <div className="showtime-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="showtime-modal event-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-event-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-header">
          <div>
            <p className="eyebrow">Saved event</p>
            <h2 id="calendar-event-title">{resolvedFilm.canonicalTitle}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="event-modal-details">
          <p><strong>{resolvedVenue.name}</strong>{resolvedVenue.address ? ` · ${resolvedVenue.address}` : ""}</p>
          <p>
            {start.toLocaleString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: "America/New_York"
            })}
            {" – "}
            {end.toLocaleTimeString("en-US", {
              hour: "numeric",
              minute: "2-digit",
              timeZone: "America/New_York"
            })}
          </p>
          {tags.length > 0 ? <p className="event-modal-tags">{tags.join(" · ")}</p> : null}
          {resolvedScreening.sourceUrl ? (
            <p>
              <a href={resolvedScreening.sourceUrl} target="_blank" rel="noreferrer">
                Theater / ticket page
              </a>
            </p>
          ) : null}
        </div>
        <div className="event-modal-actions">
          <a className="chip active" href={googleUrl} target="_blank" rel="noreferrer">
            Add to Google Calendar
          </a>
          <button type="button" className="chip" onClick={downloadIcs}>
            Download .ics
          </button>
          <button type="button" className="chip" onClick={onRemove}>
            Remove from my calendar
          </button>
        </div>
      </div>
    </div>
  );

  function downloadIcs() {
    const payload = buildIcsContent({ film: resolvedFilm, screening: resolvedScreening, venue: resolvedVenue });
    const blob = new Blob([payload], { type: "text/calendar;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${resolvedFilm.slug}-${resolvedScreening.id}.ics`;
    link.click();
    URL.revokeObjectURL(href);
  }
}
