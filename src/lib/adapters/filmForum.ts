import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import {
  collapseWhitespace,
  parseEasternLocalDateTime,
  stripHtml,
  toAbsoluteUrl
} from "@/lib/utils";

const FILM_FORUM_NOW_PLAYING_URL = "https://filmforum.org/now_playing";

const EASTERN_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const EASTERN_WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short"
});

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6
};

function formatEasternDate(date: Date): string {
  return EASTERN_DATE_FORMATTER.format(date);
}

function buildFilmForumWeek(referenceDate = new Date()): string[] {
  const easternToday = formatEasternDate(referenceDate);
  const weekday = EASTERN_WEEKDAY_FORMATTER.format(referenceDate);
  const daysFromMonday = WEEKDAY_INDEX[weekday] ?? 0;
  const easternAnchor = parseEasternLocalDateTime(easternToday, "12:00");
  const monday = new Date(easternAnchor.getTime() - daysFromMonday * 24 * 60 * 60 * 1000);

  return Array.from({ length: 7 }, (_, index) => formatEasternDate(new Date(monday.getTime() + index * 24 * 60 * 60 * 1000)));
}

function extractFilmForumTitle(html: string): string {
  const lastLine = html.split(/<br\s*\/?>/i).pop() ?? html;
  return collapseWhitespace(stripHtml(lastLine));
}

function normalizeFilmForumTime(rawTime: string, previousMinutes?: number): string {
  const match = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return rawTime;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const minutes = [
    hour === 12 ? 12 * 60 + minute : hour * 60 + minute,
    hour === 12 ? Number.NEGATIVE_INFINITY : (hour + 12) * 60 + minute
  ].filter((candidate) => candidate >= 0);

  const chosen =
    previousMinutes !== undefined
      ? minutes.find((candidate) => candidate >= previousMinutes) ?? minutes[minutes.length - 1]
      : hour >= 10 || hour === 12
        ? minutes[0]
        : minutes[minutes.length - 1];

  const chosenHour = Math.floor(chosen / 60);
  const chosenMinute = chosen % 60;
  return `${String(chosenHour).padStart(2, "0")}:${String(chosenMinute).padStart(2, "0")}`;
}

export function parseFilmForumNowPlayingHtml(payload: string, referenceDate = new Date()) {
  const weekDates = buildFilmForumWeek(referenceDate);

  return Array.from(payload.matchAll(/<div id="tabs-(\d)">([\s\S]*?)(?=<div id="tabs-\d">|<\/div>\s*<\/div>\s*<\/div>|$)/g)).flatMap(
    (tabMatch) => {
      const tabIndex = Number(tabMatch[1]);
      const date = weekDates[tabIndex];
      if (!date) {
        return [];
      }

      return Array.from(tabMatch[2].matchAll(/<p>([\s\S]*?)<\/p>/g)).flatMap((entryMatch) => {
        const entry = entryMatch[1];
        if (/showtimes coming soon/i.test(entry)) {
          return [];
        }

        const titleUrlMatch = entry.match(/<strong><a href="([^"]+)">([\s\S]*?)<\/a><\/strong>/);
        if (!titleUrlMatch) {
          return [];
        }

        const alert = collapseWhitespace(stripHtml(entry.match(/<span class="alert">([\s\S]*?)<\/span>/)?.[1] ?? ""));
        const seriesName = collapseWhitespace(
          stripHtml(entry.match(/<\/span>\s*<a href="[^"]+">([\s\S]*?)<\/a>\s*<br\s*\/?>\s*<strong>/)?.[1] ?? "")
        );
        const title = extractFilmForumTitle(titleUrlMatch[2]);
        const sourceUrl = toAbsoluteUrl(titleUrlMatch[1], FILM_FORUM_NOW_PLAYING_URL);
        const timeMatches = Array.from(entry.matchAll(/<span>(\d{1,2}:\d{2})<\/span>/g));
        let previousMinutes: number | undefined;

        return timeMatches.map((timeMatch) => {
          const normalizedTime = normalizeFilmForumTime(timeMatch[1], previousMinutes);
          const [hour, minute] = normalizedTime.split(":").map(Number);
          previousMinutes = hour * 60 + minute;

          const notes = [alert, seriesName ? `Series: ${seriesName}` : "", "Listed on Film Forum's now playing page."]
            .filter(Boolean)
            .join(" ");

          const formatTags = inferTagsFromText(`${alert} ${seriesName} ${title}`);
          if (/special|encore/i.test(alert) && !formatTags.includes("Special Event/Talkback")) {
            formatTags.push("Special Event/Talkback");
          }

          return {
            title,
            startAt: parseEasternLocalDateTime(date, normalizedTime).toISOString(),
            description: notes,
            sourceUrl,
            rawPayload: entryMatch[0],
            formatTags,
            seriesName: seriesName || undefined
          };
        });
      });
    }
  );
}

export const filmForumAdapter: VenueAdapter = {
  key: "film-forum",
  lane: "structured_html",
  canHandle: (venue) => venue.slug === "film-forum",
  async fetchIndexPages() {
    return [await fetchLiveText(FILM_FORUM_NOW_PLAYING_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [payload] = await this.fetchIndexPages();
    return parseFilmForumNowPlayingHtml(payload);
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
        detail: screenings.length > 0 ? "Weekly now-playing table parsed" : "No Film Forum screenings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Film Forum fetch failed"
      };
    }
  }
};
