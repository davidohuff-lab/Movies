import { PublicDataset, SourceStatus, SourceStatusLevel, Venue } from "@/lib/domain";

function parseErrorCode(message?: string): string | undefined {
  if (!message) {
    return undefined;
  }
  const match = message.match(/\b(403|404|408|409|429|500|502|503|504)\b/);
  return match?.[1];
}

function hintForError(errorCode?: string, message?: string): string | undefined {
  if (errorCode === "403") {
    return "Blocked (403)";
  }
  if (errorCode === "429") {
    return "Rate limited (429)";
  }
  if (errorCode === "404") {
    return "Source page missing (404)";
  }
  if (errorCode === "503" || errorCode === "502" || errorCode === "500") {
    return "Source unavailable";
  }
  if (message?.toLowerCase().includes("timed out")) {
    return "Timed out";
  }
  return message ? "Fetch issue" : undefined;
}

export function buildFallbackSourceStatuses(venues: Venue[], generatedAt: string, level: SourceStatusLevel): SourceStatus[] {
  return venues
    .filter((venue) => venue.active)
    .map((venue) => ({
      venueId: venue.id,
      venueName: venue.name,
      status: level,
      lastSuccessfulUpdate: level === "FAILED" ? undefined : generatedAt,
      lastAttemptAt: generatedAt
    }));
}

export function normalizeSourceStatuses(dataset: PublicDataset): SourceStatus[] {
  if (dataset.sourceStatuses && dataset.sourceStatuses.length > 0) {
    return dataset.sourceStatuses.map((status) => ({
      ...status,
      errorCode: status.errorCode ?? parseErrorCode(status.errorMessage),
      hint: status.hint ?? hintForError(status.errorCode ?? parseErrorCode(status.errorMessage), status.errorMessage)
    }));
  }

  return buildFallbackSourceStatuses(dataset.venues, dataset.generatedAt, dataset.dataMode === "fixture" ? "FAILED" : "CACHED");
}

export function summarizeSourceStatuses(sourceStatuses: SourceStatus[]) {
  return sourceStatuses.reduce(
    (accumulator, status) => {
      accumulator.total += 1;
      if (status.status === "OK") {
        accumulator.ok += 1;
      } else if (status.status === "CACHED") {
        accumulator.cached += 1;
      } else {
        accumulator.failed += 1;
      }
      return accumulator;
    },
    { ok: 0, cached: 0, failed: 0, total: 0 }
  );
}

export function demoteStatusesToCached(dataset: PublicDataset): PublicDataset {
  const normalized = normalizeSourceStatuses(dataset);
  return {
    ...dataset,
    sourceStatuses: normalized.map((status) => ({
      ...status,
      status: status.status === "OK" ? "CACHED" : status.status
    }))
  };
}
