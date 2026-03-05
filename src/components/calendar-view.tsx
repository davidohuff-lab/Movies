"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
import { getFullDaySchedule } from "@/lib/search";
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
  const defaultDate = getDatasetDefaultDate(dataset);
  const [preferences, setPreferences] = useState<UserPreference[]>([]);
  const [boosts, setBoosts] = useState<string[]>([]);
  const [adminOverrides, setAdminOverrides] = useState(EMPTY_ADMIN_OVERRIDE);
  const [expandedDays, setExpandedDays] = useState<string[]>([]);

  useEffect(() => {
    const rawPreferences = window.localStorage.getItem(PREFERENCES_KEY);
    const rawBoosts = window.localStorage.getItem(BOOSTS_KEY);
    const rawAdmin = window.localStorage.getItem(ADMIN_KEY);
    setPreferences(rawPreferences ? (JSON.parse(rawPreferences) as UserPreference[]) : []);
    setBoosts(rawBoosts ? (JSON.parse(rawBoosts) as string[]) : []);
    setAdminOverrides(rawAdmin ? { ...EMPTY_ADMIN_OVERRIDE, ...(JSON.parse(rawAdmin) as typeof EMPTY_ADMIN_OVERRIDE) } : EMPTY_ADMIN_OVERRIDE);
  }, []);

  const effectiveDataset = useMemo(() => applyAdminOverrides(dataset, adminOverrides), [adminOverrides, dataset]);
  const days = useMemo(() => getMonthDays(monthStart), [monthStart]);
  const fullDay = useMemo(
    () =>
      days.reduce((accumulator, day) => {
        accumulator.set(day, getFullDaySchedule(effectiveDataset, day, { preferences, liveBoosts: boosts }));
        return accumulator;
      }, new Map<string, RecommendationResult[]>()),
    [boosts, days, effectiveDataset, preferences]
  );
  const upcomingDays = useMemo(() => days.filter((day) => day >= defaultDate), [days, defaultDate]);
  const visibleDays = upcomingDays.length > 0 ? upcomingDays : days;

  return (
    <div className="calendar-stack-layout">
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
      </section>
      <section className="calendar-days-panel">
        {visibleDays.map((day) => {
          const dayItems = fullDay.get(day) ?? [];
          const topFive = dayItems.slice(0, 5);
          const hasMore = dayItems.length > 5;
          const isExpanded = expandedDays.includes(day);
          const hiddenItems = isExpanded ? dayItems.slice(5) : [];

          if (topFive.length === 0) {
            return null;
          }

          return (
            <article key={day} className="day-row">
              <div className="day-rail">
                <p className="day-rail-label">{DAYS[new Date(`${day}T00:00:00`).getDay()]}</p>
                <h3>{day}</h3>
              </div>
              <div className="day-strip">
                {topFive.map((item) => (
                  <Link key={item.screening.id} href={`/films/${item.film.slug}`} className="day-tile">
                    <div className="day-tile-image-wrap">
                      {item.film.posterUrl ? (
                        <img src={item.film.posterUrl} alt={item.film.canonicalTitle} className="day-tile-image" />
                      ) : (
                        <div className="day-tile-image placeholder">No image</div>
                      )}
                    </div>
                    <div className="day-tile-body">
                      <p className="day-tile-title">{item.film.canonicalTitle}</p>
                      <p className="day-tile-meta">
                        {item.venue.name} · {formatClock(new Date(item.screening.startAt))}
                      </p>
                      <p className="day-tile-tags">{item.tags.slice(0, 3).join(" · ")}</p>
                    </div>
                  </Link>
                ))}
                {hasMore ? (
                  <button
                    type="button"
                    className="day-more-button"
                    onClick={() => {
                      setExpandedDays(
                        isExpanded ? expandedDays.filter((candidate) => candidate !== day) : [...expandedDays, day]
                      );
                    }}
                  >
                    {isExpanded ? "Less" : "More"}
                  </button>
                ) : null}
              </div>
              {hiddenItems.length > 0 ? (
                <div className="day-strip day-strip-extra">
                  {hiddenItems.map((item) => (
                    <Link key={item.screening.id} href={`/films/${item.film.slug}`} className="day-tile compact">
                      <div className="day-tile-body">
                        <p className="day-tile-title">{item.film.canonicalTitle}</p>
                        <p className="day-tile-meta">
                          {item.venue.name} · {formatClock(new Date(item.screening.startAt))}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
