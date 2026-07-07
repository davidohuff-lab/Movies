import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Theater = {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

type LatLng = {
  lat: number;
  lng: number;
};

type NearbySearchResult = {
  place_id?: string;
  name?: string;
  vicinity?: string;
  types?: string[];
  geometry?: { location?: LatLng };
  rating?: number;
  user_ratings_total?: number;
};

type NearbySearchResponse = {
  status?: string;
  error_message?: string;
  results?: NearbySearchResult[];
  next_page_token?: string;
};

type GeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    geometry?: {
      location?: LatLng;
    };
  }>;
};

type PlaceDetailsResult = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  types?: string[];
  price_level?: number;
  rating?: number;
  user_ratings_total?: number;
  opening_hours?: {
    weekday_text?: string[];
  };
  website?: string;
  url?: string;
  geometry?: {
    location?: LatLng;
  };
};

type PlaceDetailsResponse = {
  status?: string;
  error_message?: string;
  result?: PlaceDetailsResult;
};

type DistanceMatrixElement = {
  status?: string;
  duration?: {
    value?: number;
    text?: string;
  };
  distance?: {
    value?: number;
    text?: string;
  };
};

type DistanceMatrixResponse = {
  status?: string;
  error_message?: string;
  rows?: Array<{
    elements?: DistanceMatrixElement[];
  }>;
};

type CandidatePlace = {
  placeId: string;
  name: string;
  address: string | null;
  types: string[];
  location: LatLng;
  rating: number | null;
  userRatingsTotal: number | null;
};

type PlaceDetailsCacheEntry = {
  fetchedAt: string;
  result: PlaceDetailsResult;
};

type WalkCacheRecord = {
  fetchedAt: string;
  durationSeconds: number;
  durationText: string;
  distanceMeters: number;
  distanceText: string;
};

type WalkCacheFile = {
  theaterId: string;
  updatedAt: string;
  places: Record<string, WalkCacheRecord>;
};

type FinalPlace = {
  placeId: string;
  name: string;
  address: string | null;
  types: string[];
  priceLevel: number | null;
  rating: number | null;
  userRatingsTotal: number | null;
  openingHours: {
    weekdayText: string[] | null;
  };
  websiteUrl: string | null;
  mapsUrl: string | null;
  location: LatLng;
  walk: {
    minutes: number;
    durationText: string;
    distanceMeters: number;
    distanceText: string;
  };
};

type TheaterOutput = {
  theater: {
    id: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
  };
  walkCutoffMinutes: number;
  generatedAt: string;
  places: FinalPlace[];
};

type BuilderOptions = {
  walk: number;
  theaterId: string | null;
  refreshDetails: boolean;
  maxCandidates: number;
};

const THEATER_FILE = path.join(process.cwd(), "data/theaters.json");
const NEARBY_OUTPUT_DIR = path.join(process.cwd(), "data/nearby_places");
const PLACE_CACHE_DIR = path.join(process.cwd(), "data/place_cache");
const WALK_CACHE_DIR = path.join(process.cwd(), "data/walk_cache");
const LOG_DIR = path.join(process.cwd(), "data/logs");
const LOG_FILE = path.join(LOG_DIR, "places_builder.log");
const AGGREGATED_FILE = path.join(NEARBY_OUTPUT_DIR, "all.json");
const PLACE_TYPES = ["restaurant", "bar", "cafe"] as const;
const WALK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GEOCODE_DELAY_MS = 200;
const NEXT_PAGE_DELAY_MS = 2000;
const RATE_LIMIT_BACKOFF_MS = [2000, 4000, 8000];
const DISTANCE_MATRIX_BATCH_SIZE = 25;
const NEARBY_RADIUS_METERS = 2000;
const DETAILS_FIELDS = [
  "place_id",
  "name",
  "formatted_address",
  "types",
  "price_level",
  "rating",
  "user_ratings_total",
  "opening_hours",
  "website",
  "url",
  "geometry"
].join(",");

class Logger {
  async log(message: string) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    await appendFile(LOG_FILE, line, "utf8");
    process.stdout.write(line);
  }
}

function parseArgs(argv: string[]): BuilderOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const options: BuilderOptions = {
    walk: 8,
    theaterId: null,
    refreshDetails: false,
    maxCandidates: 120
  };

  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, rawValue] = arg.slice(2).split("=", 2);
    const key = rawKey.trim();
    const value = rawValue?.trim();

    switch (key) {
      case "walk": {
        const walk = Number.parseInt(value ?? "", 10);
        if (!Number.isInteger(walk) || walk <= 0) {
          throw new Error(`Invalid --walk value: ${value ?? "(missing)"}`);
        }
        options.walk = walk;
        break;
      }
      case "theater":
        options.theaterId = value ?? null;
        break;
      case "refresh-details":
        options.refreshDetails = parseBooleanFlag(value);
        break;
      case "max-candidates": {
        const maxCandidates = Number.parseInt(value ?? "", 10);
        if (!Number.isInteger(maxCandidates) || maxCandidates <= 0) {
          throw new Error(`Invalid --max-candidates value: ${value ?? "(missing)"}`);
        }
        options.maxCandidates = maxCandidates;
        break;
      }
      default:
        throw new Error(`Unknown argument: --${key}`);
    }
  }

  return options;
}

function parseBooleanFlag(value?: string): boolean {
  if (value == null || value === "") {
    return true;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`Invalid boolean value: ${value}`);
}

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node --import tsx scripts/build_nearby_places.ts --walk=8",
      "  node --import tsx scripts/build_nearby_places.ts --walk=5",
      "  node --import tsx scripts/build_nearby_places.ts --theater=metrograph --walk=8",
      "  node --import tsx scripts/build_nearby_places.ts --refresh-details=true",
      "  node --import tsx scripts/build_nearby_places.ts --max-candidates=120"
    ].join("\n") + "\n"
  );
}

async function ensureDirectories() {
  await Promise.all([
    mkdir(path.dirname(THEATER_FILE), { recursive: true }),
    mkdir(NEARBY_OUTPUT_DIR, { recursive: true }),
    mkdir(PLACE_CACHE_DIR, { recursive: true }),
    mkdir(WALK_CACHE_DIR, { recursive: true }),
    mkdir(LOG_DIR, { recursive: true })
  ]);
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const payload = await readFile(filePath, "utf8");
  return JSON.parse(payload) as T;
}

async function readJsonFileIfExists<T>(filePath: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isFresh(isoTimestamp: string, now = Date.now()): boolean {
  const parsed = Date.parse(isoTimestamp);
  return Number.isFinite(parsed) && now - parsed < WALK_CACHE_TTL_MS;
}

function sortTypes(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function compareNullableNumberDesc(left: number | null, right: number | null): number {
  const leftValue = left ?? Number.NEGATIVE_INFINITY;
  const rightValue = right ?? Number.NEGATIVE_INFINITY;
  return rightValue - leftValue;
}

function compareNullableNumberAsc(left: number | null, right: number | null): number {
  const leftValue = left ?? Number.POSITIVE_INFINITY;
  const rightValue = right ?? Number.POSITIVE_INFINITY;
  return leftValue - rightValue;
}

function createGoogleUrl(endpoint: string, params: Record<string, string>) {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function requestGoogleJson<T>(url: URL, logger: Logger, context: string): Promise<T> {
  for (let attempt = 0; attempt <= RATE_LIMIT_BACKOFF_MS.length; attempt += 1) {
    const response = await fetch(url);
    const payloadText = await response.text();

    let payload: Record<string, unknown> = {};
    try {
      payload = payloadText ? (JSON.parse(payloadText) as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }

    const apiStatus = typeof payload.status === "string" ? payload.status : null;
    const errorMessage =
      typeof payload.error_message === "string" ? payload.error_message : response.statusText || "Unknown error";
    const rateLimitTriggered = response.status === 429 || apiStatus === "OVER_QUERY_LIMIT";

    if (rateLimitTriggered && attempt < RATE_LIMIT_BACKOFF_MS.length) {
      const waitMs = RATE_LIMIT_BACKOFF_MS[attempt];
      await logger.log(`${context}: rate limited, retrying in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      throw new Error(`${context}: HTTP ${response.status} ${errorMessage}`);
    }

    return payload as T;
  }

  throw new Error(`${context}: exhausted retries after repeated rate limiting`);
}

async function loadTheaters(): Promise<Theater[]> {
  return readJsonFile<Theater[]>(THEATER_FILE);
}

async function saveTheaters(theaters: Theater[]) {
  await writeJsonFile(THEATER_FILE, theaters);
}

async function geocodeTheater(theater: Theater, apiKey: string, logger: Logger): Promise<LatLng | null> {
  const url = createGoogleUrl("https://maps.googleapis.com/maps/api/geocode/json", {
    address: theater.address,
    key: apiKey
  });

  const payload = await requestGoogleJson<GeocodeResponse>(url, logger, `geocode:${theater.id}`);
  if (payload.status === "ZERO_RESULTS") {
    await logger.log(`geocode:${theater.id}: zero results for "${theater.address}"`);
    return null;
  }

  if (payload.status !== "OK") {
    throw new Error(`geocode:${theater.id}: ${payload.status ?? "UNKNOWN"} ${payload.error_message ?? ""}`.trim());
  }

  const location = payload.results?.[0]?.geometry?.location;
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
    await logger.log(`geocode:${theater.id}: missing geometry in best result`);
    return null;
  }

  return {
    lat: location.lat,
    lng: location.lng
  };
}

async function ensureTheaterCoordinates(theaters: Theater[], apiKey: string, logger: Logger): Promise<Theater[]> {
  let updated = false;

  for (const theater of theaters) {
    if (typeof theater.lat === "number" && typeof theater.lng === "number") {
      continue;
    }

    try {
      const location = await geocodeTheater(theater, apiKey, logger);
      if (!location) {
        continue;
      }

      theater.lat = location.lat;
      theater.lng = location.lng;
      updated = true;
      await saveTheaters(theaters);
      await logger.log(`geocode:${theater.id}: cached ${location.lat},${location.lng}`);
      await sleep(GEOCODE_DELAY_MS);
    } catch (error) {
      await logger.log(
        `geocode:${theater.id}: failed for "${theater.address}" (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  if (updated) {
    await saveTheaters(theaters);
  }

  return theaters;
}

function mergeCandidate(existing: CandidatePlace | undefined, incoming: CandidatePlace): CandidatePlace {
  if (!existing) {
    return incoming;
  }

  const hasBetterRatings =
    (incoming.userRatingsTotal ?? -1) > (existing.userRatingsTotal ?? -1) ||
    ((incoming.userRatingsTotal ?? -1) === (existing.userRatingsTotal ?? -1) &&
      (incoming.rating ?? -1) > (existing.rating ?? -1));

  return {
    placeId: existing.placeId,
    name: existing.name || incoming.name,
    address: existing.address ?? incoming.address,
    types: sortTypes([...existing.types, ...incoming.types]),
    location: existing.location ?? incoming.location,
    rating: hasBetterRatings ? incoming.rating : existing.rating,
    userRatingsTotal: hasBetterRatings ? incoming.userRatingsTotal : existing.userRatingsTotal
  };
}

async function fetchNearbySearchCandidates(theater: Theater, apiKey: string, logger: Logger): Promise<CandidatePlace[]> {
  if (typeof theater.lat !== "number" || typeof theater.lng !== "number") {
    return [];
  }

  const candidates = new Map<string, CandidatePlace>();

  for (const placeType of PLACE_TYPES) {
    let pageToken: string | undefined;
    let pageCount = 0;

    do {
      if (pageToken) {
        await logger.log(`nearby:${theater.id}:${placeType}: waiting ${NEXT_PAGE_DELAY_MS}ms for next page token`);
        await sleep(NEXT_PAGE_DELAY_MS);
      }

      const url = createGoogleUrl("https://maps.googleapis.com/maps/api/place/nearbysearch/json", {
        key: apiKey,
        ...(pageToken
          ? { pagetoken: pageToken }
          : {
              location: `${theater.lat},${theater.lng}`,
              radius: String(NEARBY_RADIUS_METERS),
              type: placeType
            })
      });

      let payload: NearbySearchResponse | null = null;
      for (let tokenAttempt = 0; tokenAttempt < 3; tokenAttempt += 1) {
        payload = await requestGoogleJson<NearbySearchResponse>(
          url,
          logger,
          `nearby:${theater.id}:${placeType}:page${pageCount + 1}`
        );

        if (pageToken && payload.status === "INVALID_REQUEST" && tokenAttempt < 2) {
          await logger.log(
            `nearby:${theater.id}:${placeType}: next_page_token not ready, retrying in ${NEXT_PAGE_DELAY_MS}ms`
          );
          await sleep(NEXT_PAGE_DELAY_MS);
          continue;
        }

        break;
      }

      if (!payload) {
        throw new Error(`nearby:${theater.id}:${placeType}: empty response`);
      }

      if (payload.status === "ZERO_RESULTS") {
        break;
      }

      if (payload.status !== "OK") {
        throw new Error(
          `nearby:${theater.id}:${placeType}: ${payload.status ?? "UNKNOWN"} ${payload.error_message ?? ""}`.trim()
        );
      }

      for (const result of payload.results ?? []) {
        const placeId = result.place_id;
        const name = result.name;
        const location = result.geometry?.location;

        if (!placeId || !name || !location || typeof location.lat !== "number" || typeof location.lng !== "number") {
          continue;
        }

        const candidate: CandidatePlace = {
          placeId,
          name,
          address: result.vicinity ?? null,
          types: sortTypes(result.types ?? [placeType]),
          location: { lat: location.lat, lng: location.lng },
          rating: typeof result.rating === "number" ? result.rating : null,
          userRatingsTotal: typeof result.user_ratings_total === "number" ? result.user_ratings_total : null
        };

        candidates.set(placeId, mergeCandidate(candidates.get(placeId), candidate));
      }

      pageToken = payload.next_page_token;
      pageCount += 1;
    } while (pageToken);
  }

  return [...candidates.values()];
}

function rankCandidates(candidates: CandidatePlace[], maxCandidates: number): CandidatePlace[] {
  return [...candidates]
    .sort((left, right) => {
      const ratingComparison = compareNullableNumberDesc(left.rating, right.rating);
      if (ratingComparison !== 0) {
        return ratingComparison;
      }

      const ratingsTotalComparison = compareNullableNumberDesc(left.userRatingsTotal, right.userRatingsTotal);
      if (ratingsTotalComparison !== 0) {
        return ratingsTotalComparison;
      }

      const nameComparison = left.name.localeCompare(right.name);
      if (nameComparison !== 0) {
        return nameComparison;
      }

      return left.placeId.localeCompare(right.placeId);
    })
    .slice(0, maxCandidates);
}

async function readFreshPlaceDetailsFromCache(placeId: string, now: number): Promise<PlaceDetailsResult | null> {
  const cacheFile = path.join(PLACE_CACHE_DIR, `${placeId}.json`);
  const cached = await readJsonFileIfExists<PlaceDetailsCacheEntry>(cacheFile);
  if (!cached?.fetchedAt || !cached.result || !isFresh(cached.fetchedAt, now)) {
    return null;
  }
  return cached.result;
}

async function fetchPlaceDetails(
  candidate: CandidatePlace,
  apiKey: string,
  logger: Logger,
  refreshDetails: boolean,
  now: number
): Promise<PlaceDetailsResult | null> {
  if (!refreshDetails) {
    const cached = await readFreshPlaceDetailsFromCache(candidate.placeId, now);
    if (cached) {
      return cached;
    }
  }

  const url = createGoogleUrl("https://maps.googleapis.com/maps/api/place/details/json", {
    place_id: candidate.placeId,
    fields: DETAILS_FIELDS,
    key: apiKey
  });

  const payload = await requestGoogleJson<PlaceDetailsResponse>(url, logger, `details:${candidate.placeId}`);
  if (payload.status !== "OK" || !payload.result) {
    const reason = `${payload.status ?? "UNKNOWN"} ${payload.error_message ?? ""}`.trim();
    await logger.log(`details:${candidate.placeId}: skipped (${reason})`);
    return null;
  }

  const cacheFile = path.join(PLACE_CACHE_DIR, `${candidate.placeId}.json`);
  const cachePayload: PlaceDetailsCacheEntry = {
    fetchedAt: new Date(now).toISOString(),
    result: payload.result
  };
  await writeJsonFile(cacheFile, cachePayload);
  return payload.result;
}

async function loadWalkCache(theaterId: string): Promise<WalkCacheFile> {
  const cacheFile = path.join(WALK_CACHE_DIR, `${theaterId}.json`);
  const cached = await readJsonFileIfExists<WalkCacheFile>(cacheFile);
  return (
    cached ?? {
      theaterId,
      updatedAt: new Date(0).toISOString(),
      places: {}
    }
  );
}

async function saveWalkCache(cache: WalkCacheFile) {
  const cacheFile = path.join(WALK_CACHE_DIR, `${cache.theaterId}.json`);
  await writeJsonFile(cacheFile, cache);
}

function getFreshWalkRecord(
  walkCache: WalkCacheFile,
  placeId: string,
  refreshDetails: boolean,
  now: number
): WalkCacheRecord | null {
  if (refreshDetails) {
    return null;
  }

  const cached = walkCache.places[placeId];
  if (!cached?.fetchedAt || !isFresh(cached.fetchedAt, now)) {
    return null;
  }

  return cached;
}

async function populateWalkCache(
  theater: Theater,
  candidates: CandidatePlace[],
  apiKey: string,
  logger: Logger,
  refreshDetails: boolean,
  now: number
): Promise<WalkCacheFile> {
  const walkCache = await loadWalkCache(theater.id);
  const uncached = candidates.filter((candidate) => !getFreshWalkRecord(walkCache, candidate.placeId, refreshDetails, now));

  if (uncached.length === 0) {
    return walkCache;
  }

  if (typeof theater.lat !== "number" || typeof theater.lng !== "number") {
    return walkCache;
  }

  for (let index = 0; index < uncached.length; index += DISTANCE_MATRIX_BATCH_SIZE) {
    const chunk = uncached.slice(index, index + DISTANCE_MATRIX_BATCH_SIZE);
    const destinations = chunk.map((candidate) => `${candidate.location.lat},${candidate.location.lng}`).join("|");
    const url = createGoogleUrl("https://maps.googleapis.com/maps/api/distancematrix/json", {
      origins: `${theater.lat},${theater.lng}`,
      destinations,
      mode: "walking",
      key: apiKey
    });

    const payload = await requestGoogleJson<DistanceMatrixResponse>(
      url,
      logger,
      `distance:${theater.id}:batch${Math.floor(index / DISTANCE_MATRIX_BATCH_SIZE) + 1}`
    );

    if (payload.status !== "OK") {
      throw new Error(`distance:${theater.id}: ${payload.status ?? "UNKNOWN"} ${payload.error_message ?? ""}`.trim());
    }

    const elements = payload.rows?.[0]?.elements ?? [];
    for (let offset = 0; offset < chunk.length; offset += 1) {
      const candidate = chunk[offset];
      const element = elements[offset];
      if (!element) {
        await logger.log(`distance:${theater.id}:${candidate.placeId}: missing matrix element`);
        continue;
      }

      if (element.status !== "OK") {
        await logger.log(
          `distance:${theater.id}:${candidate.placeId}: excluded (${element.status ?? "UNKNOWN"} from Distance Matrix)`
        );
        continue;
      }

      const durationSeconds = element.duration?.value;
      const durationText = element.duration?.text;
      const distanceMeters = element.distance?.value;
      const distanceText = element.distance?.text;

      if (
        typeof durationSeconds !== "number" ||
        typeof durationText !== "string" ||
        typeof distanceMeters !== "number" ||
        typeof distanceText !== "string"
      ) {
        await logger.log(`distance:${theater.id}:${candidate.placeId}: incomplete duration payload`);
        continue;
      }

      walkCache.places[candidate.placeId] = {
        fetchedAt: new Date(now).toISOString(),
        durationSeconds,
        durationText,
        distanceMeters,
        distanceText
      };
    }

    walkCache.updatedAt = new Date(now).toISOString();
    await saveWalkCache(walkCache);
  }

  return walkCache;
}

function buildFinalPlace(candidate: CandidatePlace, details: PlaceDetailsResult | null, walkRecord: WalkCacheRecord): FinalPlace {
  const detailLocation = details?.geometry?.location;
  const location =
    detailLocation && typeof detailLocation.lat === "number" && typeof detailLocation.lng === "number"
      ? { lat: detailLocation.lat, lng: detailLocation.lng }
      : candidate.location;

  const rating = typeof details?.rating === "number" ? details.rating : candidate.rating;
  const userRatingsTotal =
    typeof details?.user_ratings_total === "number" ? details.user_ratings_total : candidate.userRatingsTotal;

  return {
    placeId: candidate.placeId,
    name: details?.name ?? candidate.name,
    address: details?.formatted_address ?? candidate.address,
    types: sortTypes(details?.types ?? candidate.types),
    priceLevel: typeof details?.price_level === "number" ? details.price_level : null,
    rating,
    userRatingsTotal,
    openingHours: {
      weekdayText: details?.opening_hours?.weekday_text ? [...details.opening_hours.weekday_text] : null
    },
    websiteUrl: details?.website ?? null,
    mapsUrl: details?.url ?? null,
    location,
    walk: {
      minutes: Math.ceil(walkRecord.durationSeconds / 60),
      durationText: walkRecord.durationText,
      distanceMeters: walkRecord.distanceMeters,
      distanceText: walkRecord.distanceText
    }
  };
}

function sortFinalPlaces(places: FinalPlace[]): FinalPlace[] {
  return [...places].sort((left, right) => {
    const minutesComparison = left.walk.minutes - right.walk.minutes;
    if (minutesComparison !== 0) {
      return minutesComparison;
    }

    const ratingComparison = compareNullableNumberDesc(left.rating, right.rating);
    if (ratingComparison !== 0) {
      return ratingComparison;
    }

    const ratingsTotalComparison = compareNullableNumberDesc(left.userRatingsTotal, right.userRatingsTotal);
    if (ratingsTotalComparison !== 0) {
      return ratingsTotalComparison;
    }

    const distanceComparison = compareNullableNumberAsc(left.walk.distanceMeters, right.walk.distanceMeters);
    if (distanceComparison !== 0) {
      return distanceComparison;
    }

    const nameComparison = left.name.localeCompare(right.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return left.placeId.localeCompare(right.placeId);
  });
}

async function processTheater(
  theater: Theater,
  apiKey: string,
  options: BuilderOptions,
  logger: Logger,
  generatedAt: string
): Promise<TheaterOutput | null> {
  const startedAt = Date.now();

  if (typeof theater.lat !== "number" || typeof theater.lng !== "number") {
    await logger.log(`theater:${theater.id}: skipped because lat/lng are missing`);
    return null;
  }

  try {
    const nearbyCandidates = await fetchNearbySearchCandidates(theater, apiKey, logger);
    const shortlisted = rankCandidates(nearbyCandidates, options.maxCandidates);
    const now = Date.now();
    const detailsByPlaceId = new Map<string, PlaceDetailsResult | null>();

    for (const candidate of shortlisted) {
      const details = await fetchPlaceDetails(candidate, apiKey, logger, options.refreshDetails, now);
      detailsByPlaceId.set(candidate.placeId, details);
    }

    const walkCache = await populateWalkCache(theater, shortlisted, apiKey, logger, options.refreshDetails, now);
    const finalPlaces: FinalPlace[] = [];

    for (const candidate of shortlisted) {
      const walkRecord = getFreshWalkRecord(walkCache, candidate.placeId, false, Date.now());
      if (!walkRecord) {
        continue;
      }

      const finalPlace = buildFinalPlace(candidate, detailsByPlaceId.get(candidate.placeId) ?? null, walkRecord);
      if (finalPlace.walk.minutes <= options.walk) {
        finalPlaces.push(finalPlace);
      }
    }

    const output: TheaterOutput = {
      theater: {
        id: theater.id,
        name: theater.name,
        address: theater.address,
        lat: theater.lat,
        lng: theater.lng
      },
      walkCutoffMinutes: options.walk,
      generatedAt,
      places: sortFinalPlaces(finalPlaces)
    };

    const outputFile = path.join(NEARBY_OUTPUT_DIR, `${theater.id}.json`);
    await writeJsonFile(outputFile, output);

    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    await logger.log(
      `theater:${theater.id}: candidates=${nearbyCandidates.length} shortlisted=${shortlisted.length} within_cutoff=${output.places.length} elapsed=${elapsedSeconds}s`
    );

    return output;
  } catch (error) {
    await logger.log(`theater:${theater.id}: failed (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
}

async function loadExistingAggregate(): Promise<{
  walkCutoffMinutes: number;
  generatedAt: string;
  theaters: Record<string, TheaterOutput>;
} | null> {
  return readJsonFileIfExists<{
    walkCutoffMinutes: number;
    generatedAt: string;
    theaters: Record<string, TheaterOutput>;
  }>(AGGREGATED_FILE);
}

async function writeAggregateFile(
  allTheaters: Theater[],
  cutoff: number,
  generatedAt: string,
  updatedOutputs: Map<string, TheaterOutput>
) {
  const existing = await loadExistingAggregate();
  const sameCutoffExisting: Record<string, TheaterOutput> =
    existing?.walkCutoffMinutes === cutoff ? existing.theaters : {};
  const theatersRecord: Record<string, TheaterOutput> = {};

  for (const theater of allTheaters) {
    const updated = updatedOutputs.get(theater.id);
    const existingValue = sameCutoffExisting?.[theater.id];
    if (updated) {
      theatersRecord[theater.id] = updated;
    } else if (existingValue) {
      theatersRecord[theater.id] = existingValue;
    }
  }

  await writeJsonFile(AGGREGATED_FILE, {
    walkCutoffMinutes: cutoff,
    generatedAt,
    theaters: theatersRecord
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await ensureDirectories();

  const logger = new Logger();
  await logger.log(
    `build:start walk=${options.walk} theater=${options.theaterId ?? "all"} refreshDetails=${options.refreshDetails} maxCandidates=${options.maxCandidates}`
  );

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_MAPS_API_KEY is required");
  }

  const theaters = await ensureTheaterCoordinates(await loadTheaters(), apiKey, logger);
  const selectedTheaters = options.theaterId ? theaters.filter((theater) => theater.id === options.theaterId) : theaters;

  if (options.theaterId && selectedTheaters.length === 0) {
    throw new Error(`Unknown theater id: ${options.theaterId}`);
  }

  const generatedAt = new Date().toISOString();
  const outputs = new Map<string, TheaterOutput>();

  for (const theater of selectedTheaters) {
    const output = await processTheater(theater, apiKey, options, logger, generatedAt);
    if (output) {
      outputs.set(theater.id, output);
    }
  }

  await writeAggregateFile(theaters, options.walk, generatedAt, outputs);
  await logger.log(`build:complete processed=${selectedTheaters.length} successful=${outputs.size}`);
}

main().catch(async (error) => {
  await ensureDirectories();
  const logger = new Logger();
  await logger.log(`build:failed ${error instanceof Error ? error.message : String(error)}`);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
