"use client";

import { useDeferredValue, useEffect, useMemo, useState, startTransition } from "react";

import { FilmDetailDrawer } from "@/components/film-detail-drawer";
import { EMPTY_ADMIN_OVERRIDE, applyAdminOverrides } from "@/lib/client-overrides";
import { formatSnapshotDate, getDatasetDefaultDate, isFixtureDataset } from "@/lib/dataset-metadata";
import { PublicDataset, RecommendationResult, UserPreference } from "@/lib/domain";
import { searchAroundTime, searchTonight } from "@/lib/search";
import { getThreeSentenceSummary } from "@/lib/summaries";
import { FIRST_CLASS_TAGS } from "@/lib/tags";
import { formatClock } from "@/lib/utils";

const PREFERENCES_KEY = "rep-signal-preferences";
const BOOSTS_KEY = "rep-signal-boosts";
const ADMIN_KEY = "rep-signal-admin";

interface SearchExperienceProps {
  dataset: PublicDataset;
}

function loadPreferences(): UserPreference[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(PREFERENCES_KEY);
  return raw ? (JSON.parse(raw) as UserPreference[]) : [];
}

function loadBoosts(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const raw = window.localStorage.getItem(BOOSTS_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

function loadAdminOverrides() {
  if (typeof window === "undefined") {
    return EMPTY_ADMIN_OVERRIDE;
  }
  const raw = window.localStorage.getItem(ADMIN_KEY);
  return raw ? { ...EMPTY_ADMIN_OVERRIDE, ...(JSON.parse(raw) as typeof EMPTY_ADMIN_OVERRIDE) } : EMPTY_ADMIN_OVERRIDE;
}

export function SearchExperience({ dataset }: SearchExperienceProps) {
  const defaultDate = getDatasetDefaultDate(dataset);
  const [mode, setMode] = useState<"around" | "tonight">("around");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("20:00");
  const [windowMinutes, setWindowMinutes] = useState(120);
  const [venue, setVenue] = useState("");
  const [borough, setBorough] = useState("");
  const [excludeDisliked, setExcludeDisliked] = useState(true);
  const [formatOnly, setFormatOnly] = useState(false);
  const [newReleaseOnly, setNewReleaseOnly] = useState(false);
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [boosts, setBoosts] = useState<string[]>([]);
  const [adminOverrides, setAdminOverrides] = useState(EMPTY_ADMIN_OVERRIDE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setPreferences(loadPreferences());
    setBoosts(loadBoosts());
    setAdminOverrides(loadAdminOverrides());
  }, []);

  const effectiveDataset = useMemo(() => applyAdminOverrides(dataset, adminOverrides), [dataset, adminOverrides]);
  const deferredBoosts = useDeferredValue(boosts);

  const results = useMemo(() => {
    const context = { preferences, liveBoosts: deferredBoosts, now: new Date("2026-03-02T17:00:00-05:00") };
    const filters = {
      date,
      time,
      windowMinutes,
      venue: venue || undefined,
      borough: borough || undefined,
      excludeDisliked,
      formatOnly,
      newReleaseOnly
    };
    return mode === "around" ? searchAroundTime(effectiveDataset, filters, context) : searchTonight(effectiveDataset, filters, context);
  }, [borough, date, deferredBoosts, effectiveDataset, excludeDisliked, formatOnly, mode, newReleaseOnly, preferences, time, venue, windowMinutes]);

  const grouped = useMemo(() => {
    return {
      strong: results.filter((result) => result.tier === "strong"),
      medium: results.filter((result) => result.tier === "medium"),
      weak: results.filter((result) => result.tier === "weak")
    };
  }, [results]);

  const selected = useMemo(
    () => results.find((result) => result.screening.id === selectedId) ?? null,
    [results, selectedId]
  );

  function persistPreferences(next: UserPreference[]) {
    setPreferences(next);
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  }

  function toggleBoost(tag: string) {
    startTransition(() => {
      const next = boosts.includes(tag) ? boosts.filter((current) => current !== tag) : [...boosts, tag];
      setBoosts(next);
      window.localStorage.setItem(BOOSTS_KEY, JSON.stringify(next));
    });
  }

  function vote(filmId: string, thumb: "up" | "down") {
    const next = [
      ...preferences.filter((preference) => preference.filmId !== filmId),
      { filmId, thumb, createdAt: new Date().toISOString() }
    ];
    persistPreferences(next);
  }

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <p className="eyebrow">Default origin: 330 W 17th St, New York, NY</p>
        <h1>Find the best repertory screening around a time or across the night.</h1>
        <p className="hero-copy">
          Rankings blend thumbs, inferred taste, venue affinity, live tag boosts, start-time fit, and approximate subway travel.
        </p>
        {isFixtureDataset(dataset) ? (
          <div className="dataset-notice warning">
            <strong>Fixture mode.</strong> {dataset.dataStatusMessage} Snapshot date: {formatSnapshotDate(dataset.generatedAt)}.
          </div>
        ) : dataset.dataStatusMessage ? (
          <div className="dataset-notice">
            <strong>Live source status.</strong> {dataset.dataStatusMessage}
          </div>
        ) : null}
      </section>

      <section className="controls-panel">
        <div className="segment-row">
          <button type="button" className={mode === "around" ? "segment active" : "segment"} onClick={() => setMode("around")}>
            Around a time
          </button>
          <button type="button" className={mode === "tonight" ? "segment active" : "segment"} onClick={() => setMode("tonight")}>
            Tonight
          </button>
        </div>
        <div className="form-grid">
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <label>
            Time
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          {mode === "around" ? (
            <label>
              Window
              <select value={windowMinutes} onChange={(event) => setWindowMinutes(Number(event.target.value))}>
                <option value={90}>±90 min</option>
                <option value={120}>±120 min</option>
                <option value={180}>±180 min</option>
              </select>
            </label>
          ) : (
            <div className="stat-card">
              <span>Tonight mode</span>
              <strong>After {time}</strong>
            </div>
          )}
          <label>
            Venue
            <select value={venue} onChange={(event) => setVenue(event.target.value)}>
              <option value="">All venues</option>
              {effectiveDataset.venues.map((option) => (
                <option key={option.id} value={option.slug}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Borough
            <select value={borough} onChange={(event) => setBorough(event.target.value)}>
              <option value="">All boroughs</option>
              {Array.from(new Set(effectiveDataset.venues.map((option) => option.borough))).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={excludeDisliked} onChange={(event) => setExcludeDisliked(event.target.checked)} />
            Exclude disliked
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={formatOnly} onChange={(event) => setFormatOnly(event.target.checked)} />
            Format tags only
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={newReleaseOnly} onChange={(event) => setNewReleaseOnly(event.target.checked)} />
            New release only
          </label>
        </div>
        <div className="boost-row">
          {FIRST_CLASS_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={boosts.includes(tag) ? "chip active" : "chip"}
              onClick={() => toggleBoost(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </section>

      <section className="results-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">{results.length} screenings found</p>
            <h2>{mode === "around" ? "What’s Playing Around This Time" : "What’s Playing Tonight"}</h2>
          </div>
        </div>
        {(["strong", "medium", "weak"] as const).map((tier) => (
          <div key={tier} className="tier-block">
            <div className="tier-heading">
              <h3>{tier === "strong" ? "Strong matches" : tier === "medium" ? "Medium matches" : "Weak matches"}</h3>
              <span>{grouped[tier].length}</span>
            </div>
            <div className="card-list">
              {grouped[tier].map((item) => (
                <button key={item.screening.id} type="button" className="screening-card" onClick={() => setSelectedId(item.screening.id)}>
                  <div className="card-topline">
                    <span className={`badge ${item.tier}`}>{item.tier}</span>
                    <span>{formatClock(new Date(item.screening.startAt))}</span>
                  </div>
                  <h4>{item.film.canonicalTitle}</h4>
                  <p className="muted">
                    {item.venue.name} · {item.travelMinutes} min ride
                  </p>
                  <p className="reason">{item.explanation}</p>
                  <div className="tag-row">
                    {item.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="chip subtle">
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <FilmDetailDrawer
        item={selected}
        summary={selected ? getThreeSentenceSummary(selected, selected.explanation) : ""}
        preferences={preferences}
        onVote={vote}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
