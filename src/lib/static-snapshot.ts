import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { PublicDataset } from "@/lib/domain";

function cloneDataset<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readStaticSnapshot(): unknown | null {
  const snapshotPath = path.join(process.cwd(), "public/data/screenings-latest.json");
  if (!existsSync(snapshotPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(snapshotPath, "utf8"));
  } catch {
    return null;
  }
}

export function getStaticSnapshotDataset(): PublicDataset | null {
  const staticSnapshot = readStaticSnapshot();
  if (!staticSnapshot || typeof staticSnapshot !== "object") {
    return null;
  }

  const candidate = staticSnapshot as unknown as Partial<PublicDataset>;
  if (!Array.isArray(candidate.screenings) || !Array.isArray(candidate.venues) || !Array.isArray(candidate.films)) {
    return null;
  }

  return cloneDataset(candidate as PublicDataset);
}
