import { Film, Screening, Venue } from "@/lib/domain";

function formatGoogleCalendarDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

export function getEventEndDate(screening: Screening, film?: Film): { end: Date; defaulted: boolean } {
  if (screening.endAt) {
    return { end: new Date(screening.endAt), defaulted: false };
  }

  if (film?.runtimeMinutes && film.runtimeMinutes > 0) {
    return { end: new Date(new Date(screening.startAt).getTime() + film.runtimeMinutes * 60000), defaulted: false };
  }

  return { end: new Date(new Date(screening.startAt).getTime() + 2 * 60 * 60000), defaulted: true };
}

export function buildGoogleCalendarUrl({
  film,
  screening,
  venue
}: {
  film: Film;
  screening: Screening;
  venue: Venue;
}): string {
  const start = new Date(screening.startAt);
  const { end, defaulted } = getEventEndDate(screening, film);
  const url = new URL("https://calendar.google.com/calendar/render");
  const details = [
    film.synopsis ?? "",
    `Venue: ${venue.name}`,
    screening.sourceUrl ? `Tickets / event page: ${screening.sourceUrl}` : "",
    defaulted ? "Runtime unknown; defaulted to 2h." : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", film.canonicalTitle);
  url.searchParams.set("dates", `${formatGoogleCalendarDate(start)}/${formatGoogleCalendarDate(end)}`);
  url.searchParams.set("details", details);
  url.searchParams.set("location", `${venue.name}${venue.address ? `, ${venue.address}` : ""}`);
  url.searchParams.set("ctz", "America/New_York");
  return url.toString();
}

export function buildIcsContent({
  film,
  screening,
  venue
}: {
  film: Film;
  screening: Screening;
  venue: Venue;
}): string {
  const start = new Date(screening.startAt);
  const { end, defaulted } = getEventEndDate(screening, film);
  const description = [
    film.synopsis ?? "",
    screening.sourceUrl ? `Tickets / event page: ${screening.sourceUrl}` : "",
    defaulted ? "Runtime unknown; defaulted to 2h." : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Screen Ritual//Saved Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${screening.id}@screen-ritual.vercel.app`,
    `DTSTAMP:${formatGoogleCalendarDate(new Date())}`,
    `DTSTART:${formatGoogleCalendarDate(start)}`,
    `DTEND:${formatGoogleCalendarDate(end)}`,
    `SUMMARY:${escapeIcsText(film.canonicalTitle)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(`${venue.name}${venue.address ? `, ${venue.address}` : ""}`)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}
