import { revalidateTag } from "next/cache";

import { PublicDataset } from "@/lib/domain";
import { getStaticSnapshotDataset } from "@/lib/static-snapshot";
import { demoteStatusesToCached } from "@/lib/source-status";

const staticSnapshotDataset = getStaticSnapshotDataset();
let datasetCache: PublicDataset | null = null;
let refreshPromise: Promise<PublicDataset> | null = null;
let datasetLoadedAt = 0;
let lastRefreshError: string | null = null;
const LIVE_CACHE_MS = 24 * 60 * 60 * 1000;
const DATASET_CACHE_TAG = "public-dataset";
const FORCED_REFRESH_TIMEOUT_MS = 120000;

function getEasternDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function daysBetweenUtc(left: string, right: string): number {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.round((rightDate.getTime() - leftDate.getTime()) / 86400000);
}

function shiftFixtureDatasetToToday(dataset: PublicDataset): PublicDataset {
  if (dataset.screenings.length === 0) {
    return dataset;
  }

  const earliestDateKey = dataset.screenings
    .map((screening) => getEasternDateKey(new Date(screening.startAt)))
    .sort()[0];
  const todayKey = getEasternDateKey(new Date());
  if (!earliestDateKey || earliestDateKey === todayKey) {
    return dataset;
  }

  const dayOffset = daysBetweenUtc(earliestDateKey, todayKey);
  return {
    ...dataset,
    generatedAt: new Date().toISOString(),
    screenings: dataset.screenings.map((screening) => {
      const shiftedStartAt = new Date(screening.startAt);
      shiftedStartAt.setUTCDate(shiftedStartAt.getUTCDate() + dayOffset);
      const shiftedEndAt = screening.endAt ? new Date(screening.endAt) : undefined;
      if (shiftedEndAt) {
        shiftedEndAt.setUTCDate(shiftedEndAt.getUTCDate() + dayOffset);
      }

      return {
        ...screening,
        startAt: shiftedStartAt.toISOString(),
        endAt: shiftedEndAt?.toISOString()
      };
    })
  };
}

function prepareServedDataset(dataset: PublicDataset, options?: { cached?: boolean; messagePrefix?: string }): PublicDataset {
  const served = options?.cached ? demoteStatusesToCached(dataset) : dataset;
  if (!options?.messagePrefix) {
    return served;
  }
  return {
    ...served,
    dataStatusMessage: `${options.messagePrefix}${served.dataStatusMessage ? ` ${served.dataStatusMessage}` : ""}`.trim()
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function ingestRefreshDataset(useDemoData: boolean): Promise<PublicDataset> {
  if (useDemoData) {
    const { ingestTierOneFixtures } = await import("@/lib/ingest");
    return ingestTierOneFixtures();
  }

  const { ingestTierOneLive } = await import("@/lib/live-ingest");
  return ingestTierOneLive();
}

async function runRefresh(useDemoData: boolean, options?: { force?: boolean }): Promise<PublicDataset> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    if (options?.force) {
      revalidateTag(DATASET_CACHE_TAG);
    }
    const timeoutMs = FORCED_REFRESH_TIMEOUT_MS;
    return withTimeout(
      ingestRefreshDataset(useDemoData),
      timeoutMs,
      `Dataset refresh exceeded ${timeoutMs}ms`
    );
  })()
    .then((dataset) => {
      datasetCache = dataset;
      datasetLoadedAt = Date.now();
      lastRefreshError = null;
      return dataset;
    })
    .catch(async (error: unknown) => {
      lastRefreshError = error instanceof Error ? error.message : "Unknown dataset refresh error";
      if (datasetCache) {
        return prepareServedDataset(datasetCache, {
          cached: datasetCache.dataMode === "live",
          messagePrefix: datasetCache.dataMode === "live" ? `Cached snapshot in use. Live refresh failed. ${lastRefreshError}` : undefined
        });
      }

      if (staticSnapshotDataset) {
        datasetCache = prepareServedDataset({
          ...staticSnapshotDataset,
          dataStatusMessage: `Cached snapshot in use. Live refresh failed. ${lastRefreshError}`
        }, { cached: true });
        datasetLoadedAt = new Date(datasetCache.generatedAt).getTime();
        return datasetCache;
      }

      if (!datasetCache) {
        const { ingestTierOneFixtures } = await import("@/lib/ingest");
        return ingestTierOneFixtures().then((fixtureDataset) => {
          const shiftedFixtureDataset = shiftFixtureDatasetToToday(fixtureDataset);
          const fallbackDataset: PublicDataset = {
            ...shiftedFixtureDataset,
            dataMode: "fixture",
            dataStatusMessage: `Live ingest failed; showing fixture fallback aligned to current dates. ${lastRefreshError}`
          };
          return fallbackDataset;
        });
      }
      return datasetCache;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export async function getPublicDataset(): Promise<PublicDataset> {
  const useDemoData = process.env.USE_DEMO_DATA === "true";

  if (useDemoData) {
    const { ingestTierOneFixtures } = await import("@/lib/ingest");
    return shiftFixtureDatasetToToday(await ingestTierOneFixtures());
  }

  if (staticSnapshotDataset) {
    const fallback = prepareServedDataset(staticSnapshotDataset, { cached: true });
    datasetCache = fallback;
    datasetLoadedAt = new Date(fallback.generatedAt).getTime();
    lastRefreshError = null;
    return fallback;
  }

  throw new Error("No static dataset snapshot available");
}

export async function refreshPublicDataset(options?: { force?: boolean }): Promise<PublicDataset> {
  const useDemoData = process.env.USE_DEMO_DATA === "true";
  if (!options?.force && refreshPromise) {
    return refreshPromise;
  }
  return runRefresh(useDemoData, options);
}

export function getDatasetCacheStatus() {
  return {
    hasCache: Boolean(datasetCache),
    loadedAt: datasetLoadedAt ? new Date(datasetLoadedAt).toISOString() : null,
    ageMinutes: datasetLoadedAt ? Math.round((Date.now() - datasetLoadedAt) / 60000) : null,
    isRefreshing: Boolean(refreshPromise),
    lastRefreshError,
    ttlMinutes: Math.round(LIVE_CACHE_MS / 60000)
  };
}
