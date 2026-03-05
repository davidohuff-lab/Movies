import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, normalizeClockLabel, parseEasternLocalDateTime, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const IFC_HOME_URL = "https://www.ifccenter.com/";

function normalizeIfcDateKey(label: string): string {
  const match = collapseWhitespace(label).match(/^([A-Za-z]{3}\s+[A-Za-z]{3})\s+(\d{1,2})$/);
  if (!match) {
    return collapseWhitespace(label);
  }
  return `${match[1]} ${String(Number(match[2])).padStart(2, "0")}`;
}

function normalizeIfcEventTimeLabel(input: string): string {
  return /\b(am|pm)\b/i.test(input) ? input : `${input} pm`;
}

function extractIfcFilmUrls(payload: string) {
  return Array.from(
    new Set(
      Array.from(payload.matchAll(/https:\/\/www\.ifccenter\.com\/films\/[^"'#?]+\/?/g)).map((match) => match[0])
    )
  );
}

function extractIfcMetadata(payload: string, sourceUrl: string) {
  const detailMatches = Array.from(payload.matchAll(/<li><strong>([^<]+)<\/strong>\s*([\s\S]*?)<\/li>/g));
  const details = new Map(detailMatches.map((match) => [match[1].trim().toLowerCase(), collapseWhitespace(stripHtml(match[2]))]));
  const title = collapseWhitespace(stripHtml(payload.match(/<h1 class="title">([\s\S]*?)<\/h1>/)?.[1] ?? ""));
  const posterMatch = payload.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  const synopsis =
    collapseWhitespace(stripHtml(payload.match(/SHOWTIMES AT IFC CENTER<\/h2>[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1] ?? "")) ||
    collapseWhitespace(payload.match(/<meta name="description" content="([^"]+)"/)?.[1] ?? "");
  const releaseYear = Number(payload.match(/date-time">[\s\S]*?(\d{4})<\/p>/)?.[1] ?? "");
  const runtimeMinutes = Number(details.get("running time")?.match(/(\d+)/)?.[1] ?? "");
  return {
    canonicalTitle: title,
    releaseYear: Number.isNaN(releaseYear) ? undefined : releaseYear,
    runtimeMinutes: Number.isNaN(runtimeMinutes) ? undefined : runtimeMinutes,
    directors: details.get("director") ? details.get("director")!.split(",").map((item) => item.trim()) : [],
    countries: details.get("country") ? details.get("country")!.split(",").map((item) => item.trim()) : [],
    languages: details.get("language") ? details.get("language")!.split(",").map((item) => item.trim()) : [],
    synopsis: synopsis || undefined,
    posterUrl: posterMatch ? toAbsoluteUrl(posterMatch, IFC_HOME_URL) : undefined,
    metadataSourceIds: { ifc: sourceUrl }
  };
}

function isIfcWidgetPlaceholder(description: string) {
  return /listed on ifc center's home showtimes widget\.?/i.test(collapseWhitespace(description));
}

function mergeIfcHomeScreeningsWithFilmMetadata(
  homeScreenings: ReturnType<typeof parseIfcHomeWidgetHtml>,
  metadataByUrl: Map<string, ReturnType<typeof extractIfcMetadata>>
) {
  return homeScreenings.map((draft) => {
    const metadata = metadataByUrl.get(draft.sourceUrl);
    if (!metadata) {
      return draft;
    }

    return {
      ...draft,
      description: isIfcWidgetPlaceholder(draft.description) ? metadata.synopsis ?? draft.description : draft.description,
      film: {
        canonicalTitle: metadata.canonicalTitle || draft.title,
        releaseYear: metadata.releaseYear,
        runtimeMinutes: metadata.runtimeMinutes,
        directors: metadata.directors,
        countries: metadata.countries,
        languages: metadata.languages,
        synopsis: metadata.synopsis,
        posterUrl: metadata.posterUrl,
        metadataSourceIds: metadata.metadataSourceIds
      }
    };
  });
}

function extractIfcSpecialEvents(payload: string) {
  const events = new Map<string, string>();
  const matches = Array.from(
    payload.matchAll(/<span><strong>([^:]+):<\/strong><\/span>&nbsp;\s*<p><strong>([\s\S]*?)<\/strong>[\s\S]*?<\/p>/g)
  );
  matches.forEach((match) => {
    const dateLabel = normalizeIfcDateKey(collapseWhitespace(stripHtml(match[1])));
    const caption = collapseWhitespace(stripHtml(match[2]));
    const time = caption.match(/\bat\s+(\d{1,2}(?::\d{2})?(?:\s*[ap]m)?)\b/i)?.[1];
    if (!time) {
      return;
    }
    events.set(`${dateLabel}|${normalizeClockLabel(normalizeIfcEventTimeLabel(time))}`, caption);
  });
  return events;
}

export function parseIfcFilmPageHtml(sourceUrl: string, payload: string) {
  const year = Number(payload.match(/date-time">[\s\S]*?(\d{4})<\/p>/)?.[1] ?? "");
  const fallbackYear = Number.isNaN(year) ? new Date().getFullYear() : year;
  const metadata = extractIfcMetadata(payload, sourceUrl);
  const specialEvents = extractIfcSpecialEvents(payload);

  return Array.from(payload.matchAll(/<p><strong>([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2})<\/strong><\/p>\s*<ul class="times">([\s\S]*?)<\/ul>/g))
    .flatMap((match) => {
      const dateLabel = collapseWhitespace(stripHtml(match[1]));
      const normalizedDateLabel = normalizeIfcDateKey(dateLabel);
      const dateParts = dateLabel.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})$/);
      if (!dateParts) {
        return [];
      }

      const monthLookup: Record<string, string> = {
        Jan: "01",
        Feb: "02",
        Mar: "03",
        Apr: "04",
        May: "05",
        Jun: "06",
        Jul: "07",
        Aug: "08",
        Sep: "09",
        Oct: "10",
        Nov: "11",
        Dec: "12"
      };
      const date = `${fallbackYear}-${monthLookup[dateParts[1]]}-${String(Number(dateParts[2])).padStart(2, "0")}`;
      return Array.from(match[2].matchAll(/<li><span>([\s\S]*?)<\/span>/g)).map((timeMatch) => {
        const time = collapseWhitespace(stripHtml(timeMatch[1]));
        const specialEventDescription = specialEvents.get(`${normalizedDateLabel}|${normalizeClockLabel(time)}`);
        const description = specialEventDescription ?? metadata.synopsis ?? "Listed on IFC Center's film page.";
        return {
          title: metadata.canonicalTitle ?? "Unknown IFC title",
          startAt: parseEasternLocalDateTime(date, normalizeClockLabel(time)).toISOString(),
          description,
          sourceUrl,
          rawPayload: `${match[0]} ${specialEventDescription ?? ""}`,
          formatTags: inferTagsFromText(`${description} ${match[0]}`),
          film: metadata
        };
      });
    })
    .filter((draft) => draft.title && draft.startAt);
}

export function parseIfcHomeWidgetHtml(payload: string, referenceDate = new Date()) {
  const currentYear = referenceDate.getUTCFullYear();
  const monthLookup: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12"
  };
  const specialEvents = extractIfcSpecialEvents(payload);

  return payload
    .split('<div class="daily-schedule ')
    .slice(1)
    .flatMap((scheduleChunk) => {
      const dateLabel = collapseWhitespace(stripHtml(scheduleChunk.match(/<h3>([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2})<\/h3>/)?.[1] ?? ""));
      const dateParts = dateLabel.match(/^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})$/);
      if (!dateParts) {
        return [];
      }

      const date = `${currentYear}-${monthLookup[dateParts[1]]}-${String(Number(dateParts[2])).padStart(2, "0")}`;
      const normalizedDateLabel = normalizeIfcDateKey(dateLabel);

      return scheduleChunk
        .split('<div class="details">')
        .slice(1)
        .flatMap((item) => {
          const title = collapseWhitespace(stripHtml(item.match(/<h3><a href="[^"]+">([\s\S]*?)<\/a><\/h3>/)?.[1] ?? ""));
          const sourceUrl = toAbsoluteUrl(item.match(/<h3><a href="([^"]+)"/)?.[1] ?? IFC_HOME_URL, IFC_HOME_URL);

          return Array.from(item.matchAll(/<li><a [^>]+>([\s\S]*?)<\/a><\/li>/g)).map((timeMatch) => {
            const time = collapseWhitespace(stripHtml(timeMatch[1]));
            const specialEventDescription = specialEvents.get(`${normalizedDateLabel}|${normalizeClockLabel(time)}`);
            const description = specialEventDescription ?? "Listed on IFC Center's home showtimes widget.";
            return {
              title,
              startAt: parseEasternLocalDateTime(date, normalizeClockLabel(time)).toISOString(),
              description,
              sourceUrl,
              rawPayload: item,
              formatTags: inferTagsFromText(`${description} ${title} ${item}`)
            };
          });
        });
    })
    .filter((draft) => draft.title);
}

export const ifcCenterAdapter: VenueAdapter = {
  key: "ifc-center",
  lane: "structured_html",
  canHandle: (venue) => venue.slug === "ifc-center",
  async fetchIndexPages() {
    return [await fetchLiveText(IFC_HOME_URL)];
  },
  async fetchEventPages() {
    const [payload] = await this.fetchIndexPages();
    const urls = extractIfcFilmUrls(payload).map((url) => toAbsoluteUrl(url, IFC_HOME_URL));
    return Promise.all(urls.map((url) => fetchLiveText(url)));
  },
  async parseScreenings() {
    const [homePayload] = await this.fetchIndexPages();
    const homeScreenings = parseIfcHomeWidgetHtml(homePayload);
    if (homeScreenings.length > 0) {
      const urls = Array.from(new Set(homeScreenings.map((draft) => draft.sourceUrl))).filter(Boolean);
      const pagePayloads = await Promise.allSettled(urls.map((url) => fetchLiveText(url)));
      const metadataByUrl = new Map<string, ReturnType<typeof extractIfcMetadata>>();

      pagePayloads.forEach((result, index) => {
        if (result.status !== "fulfilled") {
          return;
        }
        const sourceUrl = urls[index];
        if (!sourceUrl) {
          return;
        }
        metadataByUrl.set(sourceUrl, extractIfcMetadata(result.value, sourceUrl));
      });

      return mergeIfcHomeScreeningsWithFilmMetadata(homeScreenings, metadataByUrl);
    }

    const urls = extractIfcFilmUrls(homePayload).map((url) => toAbsoluteUrl(url, IFC_HOME_URL));
    const pages = await Promise.all(urls.map((url) => fetchLiveText(url)));
    return pages.flatMap((payload, index) => parseIfcFilmPageHtml(urls[index] ?? IFC_HOME_URL, payload));
  },
  normalize(draft, context) {
    return normalizeDraftToScreening(context.venue, findFilmMatch(draft.title, context.films), draft);
  },
  async healthCheck(context) {
    try {
      const screenings = await this.parseScreenings(context);
      return {
        ok: screenings.length > 0,
        count: screenings.length,
        detail: screenings.length > 0 ? "Showtimes and special-event markers parsed" : "No IFC listings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "IFC fetch failed"
      };
    }
  }
};
