import { readFile } from "node:fs/promises";
import path from "node:path";

import { curatedVenues } from "@/lib/catalog";
import { NearbyPlacesDataset, NearbyTheaterSummary } from "@/lib/nearby-places";

type TheaterRecord = {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

const DATA_DIR = path.join(process.cwd(), "data");
const THEATERS_FILE = path.join(DATA_DIR, "theaters.json");
const NEARBY_PLACES_DIR = path.join(DATA_DIR, "nearby_places");
const THEATER_ID_PATTERN = /^[a-z0-9-]+$/;

async function readJsonFile<T>(filePath: string): Promise<T> {
  const payload = await readFile(filePath, "utf8");
  return JSON.parse(payload) as T;
}

function lookupNeighborhood(theater: TheaterRecord): string | null {
  const match = curatedVenues.find((venue) => venue.name === theater.name || venue.address === theater.address);
  return match?.neighborhood ?? null;
}

export async function readNearbyTheaters(): Promise<NearbyTheaterSummary[]> {
  const theaters = await readJsonFile<TheaterRecord[]>(THEATERS_FILE);
  return theaters.map((theater) => ({
    id: theater.id,
    name: theater.name,
    address: theater.address,
    neighborhood: lookupNeighborhood(theater)
  }));
}

export async function readNearbyPlacesDataset(theaterId: string): Promise<NearbyPlacesDataset | null> {
  if (!THEATER_ID_PATTERN.test(theaterId)) {
    throw new Error("Invalid theater id");
  }

  const filePath = path.join(NEARBY_PLACES_DIR, `${theaterId}.json`);

  try {
    return await readJsonFile<NearbyPlacesDataset>(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
