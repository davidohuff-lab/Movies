import { PublicDataset } from "@/lib/domain";
import { ingestTierOneFixtures } from "@/lib/ingest";
import { ingestTierOneLive } from "@/lib/live-ingest";

let datasetPromise: Promise<PublicDataset> | null = null;
let datasetLoadedAt = 0;
const LIVE_CACHE_MS = 5 * 60 * 1000;

export async function getPublicDataset(): Promise<PublicDataset> {
  const useDemoData = process.env.USE_DEMO_DATA === "true";
  const cacheExpired = Date.now() - datasetLoadedAt > LIVE_CACHE_MS;

  if (!datasetPromise || (!useDemoData && cacheExpired)) {
    datasetLoadedAt = Date.now();
    datasetPromise = useDemoData ? ingestTierOneFixtures() : ingestTierOneLive();
  }
  return datasetPromise;
}
