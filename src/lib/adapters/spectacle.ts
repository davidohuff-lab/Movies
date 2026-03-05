import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText } from "@/lib/tags";
import { collapseWhitespace, decodeHtmlEntities, normalizeClockLabel, stripHtml, toAbsoluteUrl } from "@/lib/utils";

const SPECTACLE_HOME_URL = "https://www.spectacletheater.com/";
const SPECTACLE_ROLLING_URL = "https://www.spectacletheater.com/spex-rolling.html";

function extractSpectacleSeriesMap(homePayload: string) {
  const map = new Map<string, string>();
  const matches = Array.from(homePayload.matchAll(/<a href="(https?:\/\/www\.spectacletheater\.com\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g));
  matches.forEach((match) => {
    const href = match[1];
    const label = collapseWhitespace(stripHtml(match[2]));
    if (href && label) {
      map.set(href, label);
    }
  });
  return map;
}

export function parseSpectacleRollingHtml(rollingPayload: string, homePayload = "") {
  const seriesMap = extractSpectacleSeriesMap(homePayload);
  const header = rollingPayload.match(/<tr>([\s\S]*?)<\/tr>/)?.[1] ?? "";
  const dates = Array.from(header.matchAll(/<!--\s*(\d{4}-\d{2}-\d{2})\s*-->/g)).map((match) => match[1]);
  const rows = Array.from(rollingPayload.matchAll(/<tr>([\s\S]*?)<\/tr>/g)).slice(1);

  return rows.flatMap((rowMatch) => {
    const cells = Array.from(rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g));
    return cells.flatMap((cellMatch, index) => {
      const date = dates[index];
      const cell = cellMatch[1];
      if (!date || !cell || /&nbsp;/.test(cell) && !/<a href=|<br\/>/.test(cell)) {
        return [];
      }

      const href = cell.match(/<a href="([^"]+)"/)?.[1];
      const absoluteUrl = href ? toAbsoluteUrl(href, SPECTACLE_HOME_URL) : SPECTACLE_ROLLING_URL;
      const time = collapseWhitespace(
        stripHtml((cell.match(/^([\s\S]*?)<br\/>/)?.[1] ?? "").replace(/<a [^>]*>/g, "").replace(/<\/a>/g, ""))
      );
      const title =
        collapseWhitespace(decodeHtmlEntities(cell.match(/<img [^>]*alt="([^"]+)"/)?.[1] ?? "")) ||
        collapseWhitespace(stripHtml(cell.split(/<br\/>/i).slice(1).join(" ")));
      if (!title || !time) {
        return [];
      }

      const seriesName = seriesMap.get(absoluteUrl);
      return [
        {
          title,
          startAt: new Date(`${date}T${normalizeClockLabel(time)}:00-05:00`).toISOString(),
          description: seriesName ? `${seriesName}.` : "Listed in Spectacle's next 7 days calendar.",
          seriesName,
          sourceUrl: absoluteUrl,
          rawPayload: cell,
          formatTags: inferTagsFromText(`${title} ${seriesName ?? ""}`)
        }
      ];
    });
  });
}

export const spectacleAdapter: VenueAdapter = {
  key: "spectacle",
  lane: "event_page",
  canHandle: (venue) => venue.slug === "spectacle-theater",
  async fetchIndexPages() {
    return [await fetchLiveText(SPECTACLE_HOME_URL), await fetchLiveText(SPECTACLE_ROLLING_URL)];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings() {
    const [homePayload, rollingPayload] = await this.fetchIndexPages();
    return parseSpectacleRollingHtml(rollingPayload, homePayload);
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
        detail: screenings.length > 0 ? "Next 7 days calendar parsed" : "No Spectacle listings found"
      };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        detail: error instanceof Error ? error.message : "Spectacle fetch failed"
      };
    }
  }
};
