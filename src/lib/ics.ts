export interface ParsedIcsEvent {
  uid: string;
  title: string;
  description: string;
  startAt: string;
  url: string;
}

export function parseIcsEvents(payload: string): ParsedIcsEvent[] {
  const chunks = payload.split("BEGIN:VEVENT").slice(1);
  return chunks.map((chunk) => {
    const get = (field: string) => {
      const match = chunk.match(new RegExp(`${field}:(.+)`));
      return match?.[1]?.trim() ?? "";
    };
    const startRaw = get("DTSTART");
    const year = startRaw.slice(0, 4);
    const month = startRaw.slice(4, 6);
    const day = startRaw.slice(6, 8);
    const hour = startRaw.slice(9, 11);
    const minute = startRaw.slice(11, 13);
    return {
      uid: get("UID"),
      title: get("SUMMARY"),
      description: get("DESCRIPTION"),
      startAt: `${year}-${month}-${day}T${hour}:${minute}:00Z`,
      url: get("URL")
    };
  });
}
