import { Film, ScreeningWithRelations } from "@/lib/domain";

const summaryCache = new Map<string, string>();

function filmNoun(film: Film): string {
  if (film.runtimeMinutes && film.runtimeMinutes >= 140) {
    return "an expansive feature";
  }
  return "a feature";
}

export function getThreeSentenceSummary(item: ScreeningWithRelations, explanation?: string): string {
  const key = `${item.film.id}-${item.screening.id}`;
  const cached = summaryCache.get(key);
  if (cached) {
    return cached;
  }

  const directors = item.film.directors.length > 0 ? item.film.directors.join(", ") : "an unknown director";
  const sentenceOne = `${item.film.canonicalTitle} is ${filmNoun(item.film)} from ${
    item.film.releaseYear ?? "an unknown year"
  } directed by ${directors} that ${item.film.synopsis ?? "arrives with limited metadata"}.`;
  const sentenceTwo = `${item.venue.name} frames this screening through ${
    item.screening.seriesName
      ? `${item.screening.seriesName.toLowerCase()}`
      : `${item.screening.descriptionRaw.replace(/\.$/, "").toLowerCase()}`
  }, giving it context beyond a generic repertory slot.`;
  const sentenceThree = `It may match your interests because ${
    explanation
      ? explanation.replace(/\s+\+\s+/g, ", ").replace(/^./, (character) => character.toLowerCase())
      : `it carries ${item.tags.slice(0, 3).join(", ")} energy`
  }.`;

  const summary = [sentenceOne, sentenceTwo, sentenceThree].join(" ");
  summaryCache.set(key, summary);
  return summary;
}
