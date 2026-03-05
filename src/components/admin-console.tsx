"use client";

import { useMemo, useState } from "react";

import { EMPTY_ADMIN_OVERRIDE } from "@/lib/client-overrides";
import { PublicDataset, Screening, Venue } from "@/lib/domain";
import { normalizeTitle, slugify } from "@/lib/utils";

const ADMIN_KEY = "rep-signal-admin";

interface AdminConsoleProps {
  dataset: PublicDataset;
  health: Array<{ venue: string; status: string; count: number; detail: string }>;
  adapters: Array<{ key: string; lane: string }>;
}

export function AdminConsole({ dataset, health, adapters }: AdminConsoleProps) {
  const [overrides, setOverrides] = useState(() => {
    if (typeof window === "undefined") {
      return EMPTY_ADMIN_OVERRIDE;
    }
    const raw = window.localStorage.getItem(ADMIN_KEY);
    return raw ? { ...EMPTY_ADMIN_OVERRIDE, ...(JSON.parse(raw) as typeof EMPTY_ADMIN_OVERRIDE) } : EMPTY_ADMIN_OVERRIDE;
  });
  const [manualTitle, setManualTitle] = useState("The Housemaid");
  const [manualVenue, setManualVenue] = useState("ifc-center");
  const [manualStartAt, setManualStartAt] = useState("2026-03-08T20:00");
  const [manualTags, setManualTags] = useState("Korean, Criterion Collection");
  const [summaryFilmId, setSummaryFilmId] = useState(dataset.films[0]?.id ?? "");
  const [summaryText, setSummaryText] = useState("");
  const [tagTargetId, setTagTargetId] = useState(dataset.screenings[0]?.id ?? "");
  const [tagOverrideText, setTagOverrideText] = useState("35MM, Special Event/Talkback");
  const [rawVenueSlug, setRawVenueSlug] = useState(
    dataset.venues.find((venue) => dataset.screenings.some((screening) => screening.venueId === venue.id))?.slug ?? "ifc-center"
  );
  const [ingestMessage, setIngestMessage] = useState("");
  const [manualVenueName, setManualVenueName] = useState("Microcinema Loft");
  const [manualVenueSlug, setManualVenueSlug] = useState("microcinema-loft");
  const [manualVenueBorough, setManualVenueBorough] = useState("Brooklyn");

  const duplicateCandidates = useMemo(() => {
    const buckets = new Map<string, Screening[]>();
    dataset.screenings.forEach((screening) => {
      const film = dataset.films.find((candidate) => candidate.id === screening.filmId);
      if (!film) {
        return;
      }
      const key = normalizeTitle(film.canonicalTitle);
      buckets.set(key, [...(buckets.get(key) ?? []), screening]);
    });
    return Array.from(buckets.values()).filter((bucket) => bucket.length > 1);
  }, [dataset.films, dataset.screenings]);

  const rawPayloadPreview = useMemo(() => {
    const venue = dataset.venues.find((candidate) => candidate.slug === rawVenueSlug);
    if (!venue) {
      return "No source payload available.";
    }

    const snapshots = dataset.screenings
      .filter((screening) => screening.venueId === venue.id)
      .slice(0, 3)
      .map((screening) => {
        const film = dataset.films.find((candidate) => candidate.id === screening.filmId);
        return `# ${film?.canonicalTitle ?? screening.eventTitleRaw} | ${screening.startAt}\n${screening.rawPayload}`;
      });

    return snapshots.join("\n\n") || "No live raw payload available for this venue.";
  }, [dataset.films, dataset.screenings, dataset.venues, rawVenueSlug]);

  function persist(next: typeof overrides) {
    setOverrides(next);
    window.localStorage.setItem(ADMIN_KEY, JSON.stringify(next));
  }

  function togglePause(venueSlug: string) {
    const pausedVenueSlugs = overrides.pausedVenueSlugs.includes(venueSlug)
      ? overrides.pausedVenueSlugs.filter((slug) => slug !== venueSlug)
      : [...overrides.pausedVenueSlugs, venueSlug];
    persist({ ...overrides, pausedVenueSlugs });
  }

  function addManualScreening() {
    const venue = dataset.venues.find((candidate) => candidate.slug === manualVenue);
    const film = dataset.films.find((candidate) => normalizeTitle(candidate.canonicalTitle) === normalizeTitle(manualTitle));
    if (!venue || !film) {
      return;
    }
    const screening: Screening = {
      id: `manual-${slugify(`${manualTitle}-${manualStartAt}`)}`,
      venueId: venue.id,
      filmId: film.id,
      startAt: new Date(`${manualStartAt}:00-05:00`).toISOString(),
      eventTitleRaw: manualTitle,
      descriptionRaw: "Manual admin override",
      formatTags: [],
      userTags: manualTags.split(",").map((tag) => tag.trim()).filter(Boolean),
      sourceType: "manual",
      sourceUrl: "manual://projection-room",
      sourceHash: slugify(`${manualTitle}-${manualStartAt}`),
      rawPayload: JSON.stringify({ manualTitle, manualStartAt, manualTags }),
      lastSeenAt: new Date().toISOString(),
      isManualOverride: true,
      isCancelled: false
    };
    persist({ ...overrides, manualScreenings: [...overrides.manualScreenings, screening] });
  }

  function saveSummaryOverride() {
    persist({
      ...overrides,
      summaryOverrides: { ...overrides.summaryOverrides, [summaryFilmId]: summaryText }
    });
  }

  function saveTagOverride() {
    persist({
      ...overrides,
      screeningTagOverrides: {
        ...overrides.screeningTagOverrides,
        [tagTargetId]: tagOverrideText.split(",").map((tag) => tag.trim()).filter(Boolean)
      }
    });
  }

  async function rerunIngestion(venueSlug: string) {
    const response = await fetch(`/api/admin/ingest/${venueSlug}`, { method: "POST" });
    const payload = await response.json();
    setIngestMessage(response.ok ? `${payload.venue}: ${payload.draftCount} drafts via ${payload.adapter}` : "Unable to re-run ingestion");
  }

  function addManualVenue() {
    const venue: Venue = {
      id: `manual-venue-${manualVenueSlug}`,
      name: manualVenueName,
      slug: manualVenueSlug,
      website: "https://example.com",
      address: "Manual venue override",
      borough: manualVenueBorough,
      lat: 40.72,
      lng: -73.96,
      neighborhood: "Manual",
      nearestSubwayStops: ["Manual stop"],
      active: true,
      adapterType: "manual",
      notes: "Admin-added venue",
      tags: [manualVenueName]
    };

    persist({
      ...overrides,
      manualVenues: [...overrides.manualVenues.filter((item) => item.slug !== venue.slug), venue]
    });
  }

  function deleteManualVenue(venueSlug: string) {
    persist({
      ...overrides,
      manualVenues: overrides.manualVenues.filter((venue) => venue.slug !== venueSlug)
    });
  }

  function deleteManualScreening(screeningId: string) {
    persist({
      ...overrides,
      manualScreenings: overrides.manualScreenings.filter((screening) => screening.id !== screeningId)
    });
  }

  return (
    <div className="admin-layout">
      <section className="panel">
        <p className="eyebrow">Venue dashboard</p>
        <h1>Adapter health and overrides</h1>
        <div className="health-grid">
          {health.map((item) => (
            <article key={item.venue} className="health-card">
              <span className={item.status === "ok" ? "dot ok" : "dot"} />
              <strong>{item.venue}</strong>
              <p>{item.detail}</p>
              <small>{item.count} screenings parsed</small>
            </article>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Venue</th>
                <th>Adapter</th>
                <th>Paused</th>
              </tr>
            </thead>
            <tbody>
              {dataset.venues.map((venue) => (
                <tr key={venue.id}>
                  <td>{venue.name}</td>
                  <td>{venue.adapterType}</td>
                  <td>
                    <button type="button" className="chip" onClick={() => togglePause(venue.slug)}>
                      {overrides.pausedVenueSlugs.includes(venue.slug) ? "Unpause" : "Pause"}
                    </button>
                    {" "}
                    <button type="button" className="chip subtle" onClick={() => rerunIngestion(venue.slug)}>
                      Re-run
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ingestMessage ? <p className="reason">{ingestMessage}</p> : null}
      </section>

      <section className="panel two-col">
        <div>
          <p className="eyebrow">Manual entries</p>
          <h2>Add screening override</h2>
          <div className="form-grid">
            <label>
              Film title
              <input value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} />
            </label>
            <label>
              Venue
              <select value={manualVenue} onChange={(event) => setManualVenue(event.target.value)}>
                {dataset.venues.map((venue) => (
                  <option key={venue.id} value={venue.slug}>
                    {venue.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start
              <input type="datetime-local" value={manualStartAt} onChange={(event) => setManualStartAt(event.target.value)} />
            </label>
            <label>
              Manual tags
              <input value={manualTags} onChange={(event) => setManualTags(event.target.value)} />
            </label>
          </div>
          <button type="button" className="primary-button" onClick={addManualScreening}>
            Save manual screening
          </button>
          <ul className="plain-list admin-list">
            {overrides.manualScreenings.map((screening) => (
              <li key={screening.id}>
                {screening.eventTitleRaw} · {screening.startAt}
                <button type="button" className="chip subtle" onClick={() => deleteManualScreening(screening.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">AI summary override</p>
          <h2>Approve or replace summary</h2>
          <label>
            Film
            <select value={summaryFilmId} onChange={(event) => setSummaryFilmId(event.target.value)}>
              {dataset.films.map((film) => (
                <option key={film.id} value={film.id}>
                  {film.canonicalTitle}
                </option>
              ))}
            </select>
          </label>
          <label>
            Summary
            <textarea rows={6} value={summaryText} onChange={(event) => setSummaryText(event.target.value)} />
          </label>
          <button type="button" className="primary-button" onClick={saveSummaryOverride}>
            Save summary override
          </button>
        </div>
      </section>

      <section className="panel two-col">
        <div>
          <p className="eyebrow">Raw source data</p>
          <h2>Registered adapters</h2>
          <label>
            Venue payload
            <select value={rawVenueSlug} onChange={(event) => setRawVenueSlug(event.target.value)}>
              {dataset.venues.map((venue) => (
                <option key={venue.slug} value={venue.slug}>
                  {venue.slug}
                </option>
              ))}
            </select>
          </label>
          <pre className="fixture-viewer">{rawPayloadPreview}</pre>
          <ul className="plain-list">
            {adapters.map((adapter) => (
              <li key={adapter.key}>
                {adapter.key} · {adapter.lane}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow">Duplicate suggestions</p>
          <h2>Potential merges</h2>
          <ul className="plain-list">
            {duplicateCandidates.map((candidate, index) => (
              <li key={index}>
                {candidate.length} screenings share normalized title{" "}
                {dataset.films.find((film) => film.id === candidate[0]?.filmId)?.canonicalTitle}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="panel two-col">
        <div>
          <p className="eyebrow">Manual retagging</p>
          <h2>Override screening tags</h2>
          <label>
            Screening
            <select value={tagTargetId} onChange={(event) => setTagTargetId(event.target.value)}>
              {dataset.screenings.map((screening) => {
                const film = dataset.films.find((item) => item.id === screening.filmId);
                return (
                  <option key={screening.id} value={screening.id}>
                    {film?.canonicalTitle} · {screening.startAt}
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            Tags
            <input value={tagOverrideText} onChange={(event) => setTagOverrideText(event.target.value)} />
          </label>
          <button type="button" className="primary-button" onClick={saveTagOverride}>
            Save tag override
          </button>
        </div>
        <div>
          <p className="eyebrow">Venue overrides</p>
          <h2>Add or remove local venues</h2>
          <div className="form-grid">
            <label>
              Venue name
              <input value={manualVenueName} onChange={(event) => setManualVenueName(event.target.value)} />
            </label>
            <label>
              Venue slug
              <input value={manualVenueSlug} onChange={(event) => setManualVenueSlug(event.target.value)} />
            </label>
            <label>
              Borough
              <select value={manualVenueBorough} onChange={(event) => setManualVenueBorough(event.target.value)}>
                {["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"].map((borough) => (
                  <option key={borough} value={borough}>
                    {borough}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button type="button" className="primary-button" onClick={addManualVenue}>
            Save venue
          </button>
          <ul className="plain-list admin-list">
            {overrides.manualVenues.map((venue) => (
              <li key={venue.id}>
                {venue.name}
                <button type="button" className="chip subtle" onClick={() => deleteManualVenue(venue.slug)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
