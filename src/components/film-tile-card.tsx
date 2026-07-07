"use client";

import Link from "next/link";

import { PosterImage } from "@/components/poster-image";
import { Venue } from "@/lib/domain";
import { getVenueFallbackImageUrl, shouldUseVenueImageOnly } from "@/lib/venue-fallback-images";

interface FilmTileCardProps {
  title: string;
  filmSlug: string;
  posterUrl?: string;
  venue: Venue;
  metaText?: string;
  secondaryText?: string;
  showtimeText?: string;
  isPinned: boolean;
  isSaved: boolean;
  isHidden: boolean;
  onTogglePin: () => void;
  onToggleCalendar: () => void;
  onToggleHide: () => void;
  showPinControl?: boolean;
  showHideControl?: boolean;
  showCalendarControl?: boolean;
  calendarTooltip?: string;
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tile-corner-icon">
      <path
        d="M12 3.5c-1.9 0-3.3 1.3-3.3 3.1 0 1 .4 1.8 1.2 2.4l-.5 4.1m2.6-9.6c1.9 0 3.3 1.3 3.3 3.1 0 1-.4 1.8-1.2 2.4l.5 4.1M8.2 13.1h7.6M12 13.1v7.4"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function HideIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="tile-corner-icon">
      <path
        d="M3 12c2.4-3.4 5.4-5.1 9-5.1s6.6 1.7 9 5.1c-2.4 3.4-5.4 5.1-9 5.1S5.4 15.4 3 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M5 19 19 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
}

export function FilmTileCard({
  title,
  filmSlug,
  posterUrl,
  venue,
  metaText,
  secondaryText,
  showtimeText,
  isPinned,
  isSaved,
  isHidden,
  onTogglePin,
  onToggleCalendar,
  onToggleHide,
  showPinControl = true,
  showHideControl = true,
  showCalendarControl = true,
  calendarTooltip
}: FilmTileCardProps) {
  const fallbackImageUrl = getVenueFallbackImageUrl(venue);
  const displayPosterUrl = shouldUseVenueImageOnly(venue) ? null : posterUrl;
  const hasActionControls = showPinControl || showHideControl || showCalendarControl;

  return (
    <article className={`day-tile ${hasActionControls ? "" : "no-actions"}`.trim()}>
      <Link href={`/films/${filmSlug}`} className="day-tile-link">
        <div className="day-tile-image-wrap">
          {displayPosterUrl || fallbackImageUrl ? (
            <PosterImage
              primaryUrl={displayPosterUrl}
              fallbackUrl={fallbackImageUrl}
              alt={displayPosterUrl ? title : `${venue.name} logo`}
              className={`day-tile-image ${displayPosterUrl ? "" : "day-tile-logo"}`.trim()}
              fill
              sizes="220px"
            />
          ) : (
            <div className="day-tile-image placeholder">No image</div>
          )}
        </div>
        <div className="day-tile-body">
          <p className="day-tile-title">{title}</p>
          {metaText ? <p className="day-tile-meta">{metaText}</p> : null}
          {secondaryText ? <p className="day-tile-tags">{secondaryText}</p> : null}
          {showtimeText ? <p className="day-tile-showtimes">{showtimeText}</p> : null}
        </div>
      </Link>
      {hasActionControls ? (
        <div className="tile-vote-row">
          {showPinControl ? (
            <button
              type="button"
              className={`tile-vote-button up ${isPinned ? "active" : ""}`}
              onClick={onTogglePin}
              aria-label={isPinned ? `Unpin ${title}` : `Pin ${title} to the front of this row`}
            >
              <PinIcon />
            </button>
          ) : null}
          {showCalendarControl ? (
            <button
              type="button"
              className={`tile-calendar-button ${isSaved ? "active" : ""}`}
              onClick={onToggleCalendar}
              aria-label={isSaved ? "Saved to Calendar" : "Save to Calendar"}
              data-tooltip={calendarTooltip ?? (isSaved ? "Saved" : "Save to Calendar")}
            >
              {isSaved ? "Saved" : "+"}
            </button>
          ) : null}
          {showHideControl ? (
            <button
              type="button"
              className={`tile-vote-button down ${isHidden ? "active" : ""}`}
              onClick={onToggleHide}
              aria-label={isHidden ? `Unhide ${title}` : `Hide ${title}`}
            >
              <HideIcon />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
