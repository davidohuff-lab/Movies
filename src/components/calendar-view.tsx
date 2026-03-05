"use client";

import { useEffect, useMemo, useState } from "react";

import { FilmDetailDrawer } from "@/components/film-detail-drawer";
import { EMPTY_ADMIN_OVERRIDE, applyAdminOverrides } from "@/lib/client-overrides";
import {
  formatMonthYear,
  formatSnapshotDate,
  getDatasetAnchorDate,
  getDatasetDefaultDate,
  getMonthDays,
  getMonthStart,
  isFixtureDataset
} from "@/lib/dataset-metadata";
import { PublicDataset, RecommendationResult, UserPreference } from "@/lib/domain";
import { getCalendarRecommendations, getFullDaySchedule } from "@/lib/search";
import { getThreeSentenceSummary } from "@/lib/summaries";
import { FIRST_CLASS_TAGS } from "@/lib/tags";
import { formatClock } from "@/lib/utils";

const PREFERENCES_KEY = "rep-signal-preferences";
const BOOSTS_KEY = "rep-signal-boosts";
const ADMIN_KEY = "rep-signal-admin";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarViewProps {
  dataset: PublicDataset;
}

export function CalendarView({ dataset }: CalendarViewProps) {
  const anchorDate = getDatasetAnchorDate(dataset);
  const monthStart = getMonthStart(anchorDate);
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [boosts, setBoosts] = useState<string[]>([]);
  const [selectedDay, setSelectedDay] = useState(getDatasetDefaultDate(dataset));
  const [adminOverrides, setAdminOverrides] = useState(EMPTY_ADMIN_OVERRIDE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const rawPreferences = window.localStorage.getItem(PREFERENCES_KEY);
    const rawBoosts = window.localStorage.getItem(BOOSTS_KEY);
    const rawAdmin = window.localStorage.getItem(ADMIN_KEY);
    setPreferences(rawPreferences ? (JSON.parse(rawPreferences) as UserPreference[]) : []);
    setBoosts(rawBoosts ? (JSON.parse(rawBoosts) as string[]) : []);
    setAdminOverrides(rawAdmin ? { ...EMPTY_ADMIN_OVERRIDE, ...(JSON.parse(rawAdmin) as typeof EMPTY_ADMIN_OVERRIDE) } : EMPTY_ADMIN_OVERRIDE);
  }, []);

  const effectiveDataset = useMemo(() => applyAdminOverrides(dataset, adminOverrides), [adminOverrides, dataset]);
  const calendarMap = useMemo(
    () => getCalendarRecommendations(effectiveDataset, monthStart, { preferences, liveBoosts: boosts }),
    [boosts, effectiveDataset, monthStart, preferences]
  );
  const fullDay = useMemo(
    () => getFullDaySchedule(effectiveDataset, selectedDay, { preferences, liveBoosts: boosts }),
    [boosts, effectiveDataset, preferences, selectedDay]
  );
  const allVisibleItems = useMemo(
    () =>
      Array.from(
        new Map(
          [...Array.from(calendarMap.values()).flat(), ...fullDay].map((item) => [item.screening.id, item] as const)
        ).values()
      ),
    [calendarMap, fullDay]
  );
  const selected = useMemo(
    () => allVisibleItems.find((item) => item.screening.id === selectedId) ?? null,
    [allVisibleItems, selectedId]
  );

  const days = useMemo(() => getMonthDays(monthStart), [monthStart]);

  function vote(filmId: string, thumb: "up" | "down") {
    const next = [
      ...preferences.filter((preference) => preference.filmId !== filmId),
      { filmId, thumb, createdAt: new Date().toISOString() }
    ];
    setPreferences(next);
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
  }

  return (
    <div className="calendar-layout">
      <section className="calendar-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">{formatMonthYear(monthStart)}</p>
            <h1>Monthly calendar</h1>
          </div>
          <div className="boost-row tight">
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
        </div>
        {isFixtureDataset(dataset) ? (
          <div className="dataset-notice warning">
            <strong>Fixture mode.</strong> {dataset.dataStatusMessage} Snapshot date: {formatSnapshotDate(dataset.generatedAt)}.
          </div>
        ) : dataset.dataStatusMessage ? (
          <div className="dataset-notice">
            <strong>Live source status.</strong> {dataset.dataStatusMessage}
          </div>
        ) : null}
        <div className="calendar-grid">
          {DAYS.map((day) => (
            <div key={day} className="calendar-head">
              {day}
            </div>
          ))}
          {days.map((day) => {
            const recommendations = calendarMap.get(day) ?? [];
            return (
              <div
                key={day}
                className={selectedDay === day ? "calendar-cell active" : "calendar-cell"}
                onClick={() => setSelectedDay(day)}
              >
                <span className="day-number">{Number(day.slice(-2))}</span>
                <div className="day-list">
                  {recommendations.map((item) => (
                    <button
                      key={item.screening.id}
                      type="button"
                      className={`day-film ${item.tier}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedDay(day);
                        setSelectedId(item.screening.id);
                      }}
                    >
                      {item.film.canonicalTitle}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>
      <section className="day-panel">
        <p className="eyebrow">Full schedule</p>
        <h2>{selectedDay}</h2>
        {selected ? (
          <FilmDetailDrawer
            item={selected}
            summary={getThreeSentenceSummary(selected, selected.explanation)}
            preferences={preferences}
            onVote={vote}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
        <div className="card-list">
          {fullDay.map((item: RecommendationResult) => (
            <button
              key={item.screening.id}
              type="button"
              className="screening-card"
              onClick={() => setSelectedId(item.screening.id)}
            >
              <div className="card-topline">
                <span className={`badge ${item.tier}`}>{item.tier}</span>
                <span>{formatClock(new Date(item.screening.startAt))}</span>
              </div>
              <h3>{item.film.canonicalTitle}</h3>
              <p className="muted">
                {item.venue.name} · {item.travelMinutes} min
              </p>
              <p className="reason">{item.explanation}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
