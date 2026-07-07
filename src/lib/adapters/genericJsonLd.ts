import { VenueAdapter } from "@/lib/adapters/base";
import { findFilmMatch, normalizeDraftToScreening } from "@/lib/adapters/helpers";
import { fetchLiveText } from "@/lib/live-fetch";
import { inferTagsFromText, isAlamoSpecialty, isPublicBookableMoMA, isSpecialtyListing } from "@/lib/tags";
import { collapseWhitespace, stripHtml, toAbsoluteUrl } from "@/lib/utils";

function flattenJsonLdNodes(input: unknown): Array<Record<string, unknown>> {
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item) => flattenJsonLdNodes(item));
  }
  if (typeof input !== "object") {
    return [];
  }

  const node = input as Record<string, unknown>;
  const nested = Object.values(node).flatMap((value) => {
    if (Array.isArray(value) || (value && typeof value === "object")) {
      return flattenJsonLdNodes(value);
    }
    return [];
  });
  return [node, ...nested];
}

function isEventNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  if (typeof type === "string") {
    return type.toLowerCase() === "event";
  }
  if (Array.isArray(type)) {
    return type.some((entry) => typeof entry === "string" && entry.toLowerCase() === "event");
  }
  return false;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const item = value.find((entry) => typeof entry === "string");
    return typeof item === "string" ? item : undefined;
  }
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.url === "string") {
      return object.url;
    }
  }
  return undefined;
}

function readOfferUrl(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = readOfferUrl(entry);
      if (url) {
        return url;
      }
    }
    return undefined;
  }
  if (typeof value === "object") {
    const offer = value as Record<string, unknown>;
    if (typeof offer.url === "string") {
      return offer.url;
    }
  }
  return undefined;
}

function passesIncludeRules(includeRules: string[] | undefined, venueSlug: string, text: string): boolean {
  if (!includeRules || includeRules.length === 0) {
    return true;
  }

  if (includeRules.includes("public-booking-only")) {
    return isPublicBookableMoMA(text);
  }

  const requiresSpecialty = includeRules.some((rule) =>
    ["imax-only", "special-events-only", "specialty-only", "signature-programming-only", "repertory-only"].includes(rule)
  );
  if (!requiresSpecialty) {
    return true;
  }

  if (venueSlug === "alamo-drafthouse") {
    return isAlamoSpecialty(text);
  }

  return isSpecialtyListing(text);
}

export function parseGenericJsonLdEvents(payload: string, venue: { website: string; slug: string; includeRules?: string[]; name: string }) {
  const scriptMatches = Array.from(
    payload.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>\s*([\s\S]*?)\s*<\/script>/gi)
  );

  const drafts = scriptMatches.flatMap((match) => {
    const rawJson = match[1];
    if (!rawJson) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawJson) as unknown;
      const nodes = flattenJsonLdNodes(parsed).filter(isEventNode);
      return nodes.flatMap((node) => {
        const name = collapseWhitespace(stripHtml(firstString(node.name) ?? ""));
        const startRaw =
          firstString(node.startDate) ??
          firstString(node.startTime) ??
          firstString((node as Record<string, unknown>).doorTime);
        if (!name || !startRaw) {
          return [];
        }

        const startDate = new Date(startRaw);
        if (Number.isNaN(startDate.getTime())) {
          return [];
        }

        const description = collapseWhitespace(stripHtml(firstString(node.description) ?? `Listed on ${venue.name}.`));
        const sourceCandidate = readOfferUrl(node.offers) ?? firstString(node.url) ?? venue.website;
        const sourceUrl = toAbsoluteUrl(sourceCandidate, venue.website);
        const posterUrlCandidate = firstString(node.image);
        const text = `${name} ${description} ${sourceUrl}`;
        if (!passesIncludeRules(venue.includeRules, venue.slug, text)) {
          return [];
        }

        return [
          {
            title: name,
            startAt: startDate.toISOString(),
            description: description || `Listed on ${venue.name}.`,
            sourceUrl,
            rawPayload: rawJson,
            formatTags: inferTagsFromText(text),
            film: {
              canonicalTitle: name,
              synopsis: description || undefined,
              posterUrl: posterUrlCandidate ? toAbsoluteUrl(posterUrlCandidate, venue.website) : undefined,
              metadataSourceIds: { jsonld: sourceUrl }
            }
          }
        ];
      });
    } catch {
      return [];
    }
  });

  const deduped = new Map<string, (typeof drafts)[number]>();
  for (const draft of drafts) {
    deduped.set(`${draft.title.toLowerCase()}::${new Date(draft.startAt).toISOString()}`, draft);
  }
  return Array.from(deduped.values());
}

export const genericJsonLdAdapter: VenueAdapter = {
  key: "generic-jsonld-events",
  lane: "event_page",
  canHandle: () => true,
  async fetchIndexPages() {
    return [];
  },
  async fetchEventPages() {
    return [];
  },
  async parseScreenings(context) {
    try {
      const payload = await fetchLiveText(context.venue.website);
      return parseGenericJsonLdEvents(payload, context.venue);
    } catch {
      return [];
    }
  },
  normalize(draft, context) {
    return normalizeDraftToScreening(context.venue, findFilmMatch(draft.title, context.films), draft);
  },
  async healthCheck(context) {
    const screenings = await this.parseScreenings(context);
    return {
      ok: true,
      count: screenings.length,
      detail: screenings.length > 0 ? "Generic JSON-LD events parsed" : "No JSON-LD event schedule found"
    };
  }
};
