import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import * as liveIngestModule from "../src/lib/live-ingest";

const { ingestTierOneLive } = liveIngestModule as unknown as {
  ingestTierOneLive: () => Promise<unknown>;
};

async function main() {
  process.env.SCREENSLATE_PAGE_META_LIMIT = process.env.SCREENSLATE_PAGE_META_LIMIT ?? "300";
  process.env.MAX_FILM_ENRICHMENTS = process.env.MAX_FILM_ENRICHMENTS ?? "180";
  process.env.MAX_SCREENING_PAGE_POSTER_CHECKS = process.env.MAX_SCREENING_PAGE_POSTER_CHECKS ?? "260";
  const dataset = (await ingestTierOneLive()) as {
    generatedAt: string;
    screenings: Array<unknown>;
    dataMode?: string;
    dataStatusMessage?: string;
  };

  if (!dataset || !Array.isArray(dataset.screenings) || dataset.screenings.length < 50) {
    throw new Error(
      `Refusing to write sparse snapshot. Expected at least 50 screenings, received ${dataset?.screenings?.length ?? 0}.`
    );
  }

  const snapshot = {
    ...dataset,
    screenings: dataset.screenings.map((screening) => {
      const { rawPayload: _rawPayload, ...publicScreening } = screening as Record<string, unknown>;
      return {
        ...publicScreening,
        rawPayload: ""
      };
    }),
    dataMode: "live",
    dataStatusMessage: `Cached snapshot built at ${dataset.generatedAt}.`
  };

  const outputPaths = [
    path.join(process.cwd(), "public/data/screenings-latest.json"),
    path.join(process.cwd(), "src/lib/fixtures/liveSnapshot.json")
  ];

  for (const outputPath of outputPaths) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(snapshot));
    process.stdout.write(`Wrote ${snapshot.screenings.length} screenings to ${outputPath}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
