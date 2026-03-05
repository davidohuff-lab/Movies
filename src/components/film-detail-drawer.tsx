"use client";

import Link from "next/link";

import { RecommendationResult, UserPreference } from "@/lib/domain";
import { formatCalendarDate, formatClock } from "@/lib/utils";

interface FilmDetailDrawerProps {
  item: RecommendationResult | null;
  summary: string;
  preferences: UserPreference[];
  onVote: (filmId: string, thumb: "up" | "down") => void;
  onClose: () => void;
}

export function FilmDetailDrawer({ item, summary, preferences, onVote, onClose }: FilmDetailDrawerProps) {
  if (!item) {
    return null;
  }

  const currentVote = preferences.find((preference) => preference.filmId === item.film.id)?.thumb;
  const directors = item.film.directors.length > 0 ? item.film.directors.join(", ") : "Director unknown";
  const briefDescription = item.film.synopsis
    ? item.film.synopsis
        .split(/(?<=[.!?])\s+/)
        .slice(0, 2)
        .join(" ")
    : summary
        .split(/(?<=[.!?])\s+/)
        .slice(0, 2)
        .join(" ");

  return (
    <aside className="detail-drawer">
      <div className="drawer-header">
        <div>
          <p className="eyebrow">{item.venue.name}</p>
          <h2>{item.film.canonicalTitle}</h2>
          <p className="detail-meta">
            {item.film.releaseYear ?? "Year unknown"} · {item.film.runtimeMinutes ?? "?"} min ·{" "}
            {directors}
          </p>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>
          Close
        </button>
      </div>
      {item.film.posterUrl ? (
        <div className="detail-poster-wrap">
          <img src={item.film.posterUrl} alt={`${item.film.canonicalTitle} poster`} className="detail-poster" />
        </div>
      ) : null}
      <div className="detail-section">
        <h3>Film</h3>
        <p>{item.film.canonicalTitle}</p>
        <p>
          Theater: <strong>{item.venue.name}</strong>
        </p>
        <p>
          <a href={item.screening.sourceUrl} target="_blank" rel="noreferrer" className="detail-link">
            Theater page with film
          </a>
        </p>
      </div>
      <div className="detail-section">
        <h3>Description</h3>
        <p>{briefDescription}</p>
      </div>
      <div className="detail-section">
        <p>
          {formatCalendarDate(new Date(item.screening.startAt))} at {formatClock(new Date(item.screening.startAt))}
        </p>
        <p>Approximate travel: {item.travelMinutes} min from 330 W 17th St</p>
        <p>Tags: {item.tags.join(", ")}</p>
      </div>
      <div className="detail-section">
        <h3>Why it matches</h3>
        <p>{item.explanation}</p>
      </div>
      <div className="detail-section">
        <h3>3-sentence summary</h3>
        <p>{summary}</p>
      </div>
      <div className="vote-row">
        <button
          type="button"
          className={currentVote === "up" ? "vote-button active" : "vote-button"}
          onClick={() => onVote(item.film.id, "up")}
        >
          Thumbs up
        </button>
        <button
          type="button"
          className={currentVote === "down" ? "vote-button active down" : "vote-button down"}
          onClick={() => onVote(item.film.id, "down")}
        >
          Thumbs down
        </button>
      </div>
    </aside>
  );
}
