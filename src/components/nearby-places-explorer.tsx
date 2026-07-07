"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { useRouter } from "next/navigation";

import {
  NearbyPlace,
  NearbyPlacesDataset,
  NearbyTheaterSummary,
  PlaceBucket,
  PLACE_BUCKETS,
  formatPlaceType,
  formatPriceLevel,
  getPlaceBuckets,
  getPlaceTypeLine,
  getTodayHours
} from "@/lib/nearby-places";

const FAVORITES_KEY = "screen-ritual-nearby-favorites";
const HIDDEN_KEY = "screen-ritual-nearby-hidden";

type SortMode = "closest" | "best-rated" | "best-value";
type DatasetState = "idle" | "loading" | "ready" | "missing" | "error";

interface NearbyPlacesExplorerProps {
  initialTheaterId: string | null;
}

function loadStoredPlaceIds(key: string): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function persistStoredPlaceIds(key: string, values: string[]) {
  window.localStorage.setItem(key, JSON.stringify(values));
}

function formatGeneratedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Unknown";
  }

  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York"
  });
}

function formatRating(place: NearbyPlace): string {
  if (place.rating == null) {
    return "Unrated";
  }

  if (place.userRatingsTotal == null) {
    return `${place.rating.toFixed(1)}`;
  }

  return `${place.rating.toFixed(1)} (${place.userRatingsTotal.toLocaleString("en-US")})`;
}

function valueBand(place: NearbyPlace): number {
  if (place.priceLevel == null) {
    return 1;
  }
  if (place.priceLevel <= 2) {
    return 0;
  }
  return 2;
}

function sortPlaces(places: NearbyPlace[], sortMode: SortMode): NearbyPlace[] {
  return [...places].sort((left, right) => {
    if (sortMode === "best-rated") {
      return (
        (right.rating ?? -1) - (left.rating ?? -1) ||
        (right.userRatingsTotal ?? -1) - (left.userRatingsTotal ?? -1) ||
        left.walk.minutes - right.walk.minutes ||
        left.name.localeCompare(right.name)
      );
    }

    if (sortMode === "best-value") {
      return (
        valueBand(left) - valueBand(right) ||
        (right.rating ?? -1) - (left.rating ?? -1) ||
        left.walk.minutes - right.walk.minutes ||
        (right.userRatingsTotal ?? -1) - (left.userRatingsTotal ?? -1) ||
        left.name.localeCompare(right.name)
      );
    }

    return (
      left.walk.minutes - right.walk.minutes ||
      (right.rating ?? -1) - (left.rating ?? -1) ||
      (right.userRatingsTotal ?? -1) - (left.userRatingsTotal ?? -1) ||
      left.name.localeCompare(right.name)
    );
  });
}

export function NearbyPlacesExplorer({ initialTheaterId }: NearbyPlacesExplorerProps) {
  const router = useRouter();
  const [theaters, setTheaters] = useState<NearbyTheaterSummary[]>([]);
  const [theatersState, setTheatersState] = useState<DatasetState>("idle");
  const [selectedTheaterId, setSelectedTheaterId] = useState<string | null>(initialTheaterId);
  const [dataset, setDataset] = useState<NearbyPlacesDataset | null>(null);
  const [datasetState, setDatasetState] = useState<DatasetState>("idle");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sortMode, setSortMode] = useState<SortMode>("closest");
  const [activeBuckets, setActiveBuckets] = useState<PlaceBucket[]>([...PLACE_BUCKETS]);
  const [limitPrice, setLimitPrice] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [favoritePlaceIds, setFavoritePlaceIds] = useState<string[]>([]);
  const [hiddenPlaceIds, setHiddenPlaceIds] = useState<string[]>([]);
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);

  useEffect(() => {
    setFavoritePlaceIds(loadStoredPlaceIds(FAVORITES_KEY));
    setHiddenPlaceIds(loadStoredPlaceIds(HIDDEN_KEY));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTheaters() {
      setTheatersState("loading");
      try {
        const response = await fetch("/api/theaters", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("theaters");
        }

        const payload = (await response.json()) as { theaters?: NearbyTheaterSummary[] };
        if (cancelled) {
          return;
        }

        const nextTheaters = Array.isArray(payload.theaters) ? payload.theaters : [];
        setTheaters(nextTheaters);
        setTheatersState("ready");
      } catch {
        if (!cancelled) {
          setTheatersState("error");
        }
      }
    }

    void loadTheaters();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (theaters.length === 0) {
      return;
    }

    const selectedExists = selectedTheaterId ? theaters.some((theater) => theater.id === selectedTheaterId) : false;
    if (selectedExists) {
      return;
    }

    const defaultTheaterId = theaters[0].id;
    startTransition(() => {
      setSelectedTheaterId(defaultTheaterId);
      router.replace(`/places?theater=${encodeURIComponent(defaultTheaterId)}`, { scroll: false });
    });
  }, [router, selectedTheaterId, theaters]);

  useEffect(() => {
    if (!selectedTheaterId) {
      return;
    }

    const theaterId = selectedTheaterId;
    let cancelled = false;

    async function loadDataset() {
      setDatasetState("loading");
      setDataset(null);
      try {
        const response = await fetch(`/api/nearby-places?theaterId=${encodeURIComponent(theaterId)}`, {
          cache: "no-store"
        });

        if (cancelled) {
          return;
        }

        if (response.status === 404) {
          setDatasetState("missing");
          return;
        }

        if (!response.ok) {
          throw new Error("nearby-places");
        }

        const payload = (await response.json()) as NearbyPlacesDataset;
        if (cancelled) {
          return;
        }

        setDataset(payload);
        setDatasetState("ready");
      } catch {
        if (!cancelled) {
          setDatasetState("error");
        }
      }
    }

    void loadDataset();
    return () => {
      cancelled = true;
    };
  }, [selectedTheaterId]);

  useEffect(() => {
    if (!dataset?.places.some((place) => place.placeId === activePlaceId)) {
      setActivePlaceId(null);
    }
  }, [activePlaceId, dataset]);

  const favoriteSet = useMemo(() => new Set(favoritePlaceIds), [favoritePlaceIds]);
  const hiddenSet = useMemo(() => new Set(hiddenPlaceIds), [hiddenPlaceIds]);

  const filteredPlaces = useMemo(() => {
    if (!dataset) {
      return [];
    }

    const searchTerm = deferredSearch.trim().toLowerCase();

    return sortPlaces(
      dataset.places.filter((place) => {
        if (!showHidden && hiddenSet.has(place.placeId)) {
          return false;
        }

        if (searchTerm && !place.name.toLowerCase().includes(searchTerm)) {
          return false;
        }

        const buckets = getPlaceBuckets(place);
        if (activeBuckets.length > 0 && !activeBuckets.some((bucket) => buckets.has(bucket))) {
          return false;
        }

        if (limitPrice && place.priceLevel != null && place.priceLevel > 3) {
          return false;
        }

        return true;
      }),
      sortMode
    );
  }, [activeBuckets, dataset, deferredSearch, hiddenSet, limitPrice, showHidden, sortMode]);

  const activePlace = useMemo(
    () => dataset?.places.find((place) => place.placeId === activePlaceId) ?? null,
    [activePlaceId, dataset]
  );

  const selectedTheater = useMemo(
    () => theaters.find((theater) => theater.id === selectedTheaterId) ?? null,
    [selectedTheaterId, theaters]
  );

  const hiddenCount = useMemo(
    () => dataset?.places.filter((place) => hiddenSet.has(place.placeId)).length ?? 0,
    [dataset, hiddenSet]
  );

  function updateSelectedTheater(nextTheaterId: string) {
    startTransition(() => {
      setSelectedTheaterId(nextTheaterId);
      router.replace(`/places?theater=${encodeURIComponent(nextTheaterId)}`, { scroll: false });
    });
  }

  function toggleBucket(bucket: PlaceBucket) {
    setActiveBuckets((current) =>
      current.includes(bucket) ? current.filter((value) => value !== bucket) : [...current, bucket]
    );
  }

  function toggleFavorite(placeId: string) {
    setFavoritePlaceIds((current) => {
      const next = current.includes(placeId) ? current.filter((value) => value !== placeId) : [...current, placeId];
      persistStoredPlaceIds(FAVORITES_KEY, next);
      return next;
    });
  }

  function toggleHidden(placeId: string) {
    setHiddenPlaceIds((current) => {
      const next = current.includes(placeId) ? current.filter((value) => value !== placeId) : [...current, placeId];
      persistStoredPlaceIds(HIDDEN_KEY, next);
      return next;
    });
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <p className="eyebrow">Nearby Places</p>
        <h1>Nearby Places</h1>
        <p className="hero-copy">Bars, restaurants, and cafes within an 8-minute walk of NYC theaters.</p>
      </section>

      <div className="places-layout">
        <aside className="panel places-sidebar">
          <div className="section-header">
            <div>
              <p className="eyebrow">Theaters</p>
              <h2>Pick a house</h2>
            </div>
            <span className="muted">{theaters.length} total</span>
          </div>

          {theatersState === "error" ? (
            <p className="muted">The theater list is unavailable right now.</p>
          ) : null}

          <div className="places-theater-list">
            {theaters.map((theater) => (
              <button
                key={theater.id}
                type="button"
                className={theater.id === selectedTheaterId ? "places-theater-button active" : "places-theater-button"}
                aria-pressed={theater.id === selectedTheaterId}
                onClick={() => updateSelectedTheater(theater.id)}
              >
                <span className="places-theater-name">{theater.name}</span>
                {theater.neighborhood ? <span className="places-theater-hint">{theater.neighborhood}</span> : null}
                <span className="places-theater-address">{theater.address}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel places-results-panel">
          <label className="places-mobile-picker">
            Theater
            <select
              value={selectedTheaterId ?? ""}
              onChange={(event) => updateSelectedTheater(event.target.value)}
              disabled={theaters.length === 0}
            >
              {theaters.map((theater) => (
                <option key={theater.id} value={theater.id}>
                  {theater.name}
                </option>
              ))}
            </select>
          </label>

          <div className="places-toolbar">
            <div className="places-toolbar-top">
              <div>
                <p className="eyebrow">Selected theater</p>
                <h2>{dataset?.theater.name ?? selectedTheater?.name ?? "Loading theater..."}</h2>
                <p className="muted">{dataset?.theater.address ?? selectedTheater?.address ?? " "}</p>
              </div>
              <div className="places-toolbar-meta">
                <span className="places-cutoff-badge">
                  Within {dataset?.walkCutoffMinutes ?? 8} min walk
                </span>
                {dataset ? <span className="muted">Generated at: {formatGeneratedAt(dataset.generatedAt)}</span> : null}
              </div>
            </div>

            <div className="places-controls-grid">
              <label>
                Search places
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search places..."
                />
              </label>

              <label>
                Sort
                <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}>
                  <option value="closest">Closest</option>
                  <option value="best-rated">Best rated</option>
                  <option value="best-value">Best value</option>
                </select>
              </label>
            </div>

            <div className="places-chip-row">
              {PLACE_BUCKETS.map((bucket) => (
                <button
                  key={bucket}
                  type="button"
                  className={activeBuckets.includes(bucket) ? "chip active" : "chip"}
                  aria-pressed={activeBuckets.includes(bucket)}
                  onClick={() => toggleBucket(bucket)}
                >
                  {formatPlaceType(bucket)}
                </button>
              ))}
              <button
                type="button"
                className={limitPrice ? "chip active" : "chip"}
                aria-pressed={limitPrice}
                onClick={() => setLimitPrice((current) => !current)}
              >
                $$$ or less
              </button>
              <button
                type="button"
                className={showHidden ? "chip active" : "chip subtle"}
                aria-pressed={showHidden}
                onClick={() => setShowHidden((current) => !current)}
              >
                Show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
              </button>
              <span className="places-disabled-note">Open now unavailable in cached dataset</span>
            </div>

            <p className="places-count">
              {datasetState === "ready" ? `Showing ${filteredPlaces.length} places` : "Loading nearby places..."}
            </p>
          </div>

          {datasetState === "loading" ? (
            <div className="places-empty-state">
              <p className="eyebrow">Loading</p>
              <h2>Pulling the local dataset...</h2>
              <p className="muted">Switching theaters is instant once the JSON file is in place.</p>
            </div>
          ) : null}

          {datasetState === "missing" ? (
            <div className="places-empty-state">
              <p className="eyebrow">No dataset yet</p>
              <h2>No dataset found for this theater yet.</h2>
              <p className="muted">Run the nearby-places builder and reload this page.</p>
            </div>
          ) : null}

          {datasetState === "error" ? (
            <div className="places-empty-state">
              <p className="eyebrow">Unavailable</p>
              <h2>Nearby places are unavailable right now.</h2>
              <p className="muted">Try again in a moment.</p>
            </div>
          ) : null}

          {datasetState === "ready" && filteredPlaces.length === 0 ? (
            <div className="places-empty-state">
              <p className="eyebrow">No matches</p>
              <h2>No places match your current filters.</h2>
              <p className="muted">Try widening the price cap, clearing search, or turning hidden places back on.</p>
            </div>
          ) : null}

          {datasetState === "ready" && filteredPlaces.length > 0 ? (
            <div className="places-card-list">
              {filteredPlaces.map((place) => {
                const isFavorite = favoriteSet.has(place.placeId);
                const isHidden = hiddenSet.has(place.placeId);

                return (
                  <article
                    key={place.placeId}
                    className={`places-card ${isFavorite ? "favorite" : ""} ${isHidden ? "is-hidden" : ""}`.trim()}
                  >
                    <div className="places-card-top">
                      <div>
                        <button type="button" className="places-card-name" onClick={() => setActivePlaceId(place.placeId)}>
                          {place.name}
                        </button>
                        <p className="muted">{place.address ?? "Address unknown"}</p>
                      </div>
                      <div className="places-card-badges">
                        <span className="places-walk-badge">{place.walk.minutes} min walk</span>
                        {isFavorite ? <span className="places-favorite-badge">Starred</span> : null}
                      </div>
                    </div>

                    <div className="places-card-meta">
                      <span>{formatRating(place)}</span>
                      <span>{formatPriceLevel(place.priceLevel)}</span>
                      {isHidden ? <span>Hidden</span> : null}
                    </div>

                    <p className="places-card-type-line">{getPlaceTypeLine(place)}</p>
                    <p className="places-card-hours">{getTodayHours(place.openingHours.weekdayText)}</p>

                    <div className="places-card-links">
                      {place.mapsUrl ? (
                        <a href={place.mapsUrl} target="_blank" rel="noreferrer">
                          Map
                        </a>
                      ) : null}
                      {place.websiteUrl ? (
                        <a href={place.websiteUrl} target="_blank" rel="noreferrer">
                          Website
                        </a>
                      ) : null}
                      <button type="button" aria-pressed={isFavorite} onClick={() => toggleFavorite(place.placeId)}>
                        {isFavorite ? "Unstar" : "Star"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      </div>

      <PlaceDetailModal
        place={activePlace}
        favorite={activePlace ? favoriteSet.has(activePlace.placeId) : false}
        hidden={activePlace ? hiddenSet.has(activePlace.placeId) : false}
        onClose={() => setActivePlaceId(null)}
        onToggleFavorite={() => {
          if (activePlace) {
            toggleFavorite(activePlace.placeId);
          }
        }}
        onToggleHidden={() => {
          if (activePlace) {
            toggleHidden(activePlace.placeId);
          }
        }}
      />
    </div>
  );
}

interface PlaceDetailModalProps {
  place: NearbyPlace | null;
  favorite: boolean;
  hidden: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
  onToggleHidden: () => void;
}

function PlaceDetailModal({ place, favorite, hidden, onClose, onToggleFavorite, onToggleHidden }: PlaceDetailModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!place || !dialogRef.current) {
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
  }, [onClose, place]);

  if (!place) {
    return null;
  }

  return (
    <div className="showtime-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="showtime-modal places-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="places-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-header">
          <div>
            <p className="eyebrow">Place details</p>
            <h2 id="places-detail-title">{place.name}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="places-detail-stack">
          <p>
            <strong>{place.address ?? "Address unknown"}</strong>
          </p>
          <p>
            {place.walk.minutes} min walk · {place.walk.distanceText}
          </p>
          <p>
            {formatRating(place)} · {formatPriceLevel(place.priceLevel)}
          </p>
          <p>{getPlaceTypeLine(place)}</p>
        </div>

        <div className="places-detail-hours">
          <h3>Hours</h3>
          {place.openingHours.weekdayText ? (
            <ul className="plain-list">
              {place.openingHours.weekdayText.map((entry) => (
                <li key={entry}>{entry}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Hours unknown.</p>
          )}
        </div>

        <div className="places-detail-links">
          {place.mapsUrl ? (
            <a className="chip active" href={place.mapsUrl} target="_blank" rel="noreferrer">
              Open in Google Maps
            </a>
          ) : null}
          {place.websiteUrl ? (
            <a className="chip" href={place.websiteUrl} target="_blank" rel="noreferrer">
              Website
            </a>
          ) : null}
          <button type="button" className={favorite ? "chip active" : "chip"} aria-pressed={favorite} onClick={onToggleFavorite}>
            {favorite ? "Starred" : "Star"}
          </button>
          <button type="button" className={hidden ? "chip active" : "chip"} aria-pressed={hidden} onClick={onToggleHidden}>
            {hidden ? "Unhide" : "Hide"}
          </button>
        </div>
      </div>
    </div>
  );
}
