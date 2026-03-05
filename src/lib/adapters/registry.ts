import { VenueAdapter } from "@/lib/adapters/base";
import { filmForumAdapter } from "@/lib/adapters/filmForum";
import { filmNoirAdapter } from "@/lib/adapters/filmNoir";
import { ifcCenterAdapter } from "@/lib/adapters/ifcCenter";
import { lowCinemaAdapter } from "@/lib/adapters/lowCinema";
import { metrographAdapter } from "@/lib/adapters/metrograph";
import { movingImageAdapter } from "@/lib/adapters/movingImage";
import { parisTheaterAdapter } from "@/lib/adapters/parisTheater";
import { quadCinemaAdapter } from "@/lib/adapters/quadCinema";
import { spectacleAdapter } from "@/lib/adapters/spectacle";
import { Film, Venue } from "@/lib/domain";

const adapters: VenueAdapter[] = [
  filmForumAdapter,
  filmNoirAdapter,
  lowCinemaAdapter,
  ifcCenterAdapter,
  quadCinemaAdapter,
  metrographAdapter,
  parisTheaterAdapter,
  spectacleAdapter,
  movingImageAdapter
];

export function getAdapterForVenue(venue: Venue): VenueAdapter | undefined {
  return adapters.find((adapter) => adapter.canHandle(venue));
}

export async function getVenueHealth(venue: Venue, films: Film[]) {
  const adapter = getAdapterForVenue(venue);
  if (!adapter) {
    return { ok: false, count: 0, detail: "No adapter registered" };
  }
  return adapter.healthCheck({ venue, films });
}

export function getRegisteredAdapters(): VenueAdapter[] {
  return adapters;
}
