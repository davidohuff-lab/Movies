export const SAVED_CALENDAR_KEY = "screen-ritual-saved-calendar";
export const PINNED_TILE_KEYS_KEY = "screen-ritual-pinned-tiles";

function uniqueScreeningIds(screeningIds: string[]): string[] {
  return Array.from(new Set(screeningIds.filter(Boolean)));
}

export function readSavedScreeningIds(storage: Storage): string[] {
  const rawValue = storage.getItem(SAVED_CALENDAR_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as string[];
    return Array.isArray(parsed) ? uniqueScreeningIds(parsed) : [];
  } catch {
    return [];
  }
}

export function writeSavedScreeningIds(storage: Storage, screeningIds: string[]): string[] {
  const next = uniqueScreeningIds(screeningIds);
  storage.setItem(SAVED_CALENDAR_KEY, JSON.stringify(next));
  return next;
}

export function readPinnedTileKeys(storage: Storage): string[] {
  const rawValue = storage.getItem(PINNED_TILE_KEYS_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as string[];
    return Array.isArray(parsed) ? Array.from(new Set(parsed.filter(Boolean))) : [];
  } catch {
    return [];
  }
}

export function writePinnedTileKeys(storage: Storage, tileKeys: string[]): string[] {
  const next = Array.from(new Set(tileKeys.filter(Boolean)));
  storage.setItem(PINNED_TILE_KEYS_KEY, JSON.stringify(next));
  return next;
}

export function parseSharedCalendarParam(value: string | string[] | null | undefined): string[] {
  if (!value) {
    return [];
  }

  const flattened = Array.isArray(value) ? value.join(",") : value;
  return uniqueScreeningIds(
    flattened
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean)
  );
}

export function buildSharedCalendarHref(screeningIds: string[], origin: string): string {
  const ids = uniqueScreeningIds(screeningIds);
  const base = new URL("/calendar", origin);
  if (ids.length > 0) {
    base.searchParams.set("items", ids.join(","));
  }
  return base.toString();
}
