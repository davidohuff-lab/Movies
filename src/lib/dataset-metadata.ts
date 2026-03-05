import { PublicDataset } from "@/lib/domain";

function getSortedScreeningDates(dataset: PublicDataset): Date[] {
  return dataset.screenings.map((screening) => new Date(screening.startAt)).sort((left, right) => left.getTime() - right.getTime());
}

export function getDatasetAnchorDate(dataset: PublicDataset): Date {
  return getSortedScreeningDates(dataset)[0] ?? new Date(dataset.generatedAt);
}

export function getDatasetDefaultDate(dataset: PublicDataset): string {
  return getDatasetAnchorDate(dataset).toISOString().slice(0, 10);
}

export function getMonthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function getMonthDays(date: Date): string[] {
  const firstDay = getMonthStart(date);
  const daysInMonth = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const day = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), index + 1));
    return day.toISOString().slice(0, 10);
  });
}

export function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "America/New_York"
  }).format(date);
}

export function formatSnapshotDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York"
  }).format(new Date(value));
}

export function isFixtureDataset(dataset: PublicDataset): boolean {
  return dataset.dataMode === "fixture";
}
