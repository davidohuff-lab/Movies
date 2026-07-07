import { VenueAdapter } from "@/lib/adapters/base";
import { amcImaxAdapter } from "@/lib/adapters/amcImax";
import { angelikaAdapter } from "@/lib/adapters/angelika";
import { bamAdapter } from "@/lib/adapters/bam";
import { filmForumAdapter } from "@/lib/adapters/filmForum";
import { filmNoirAdapter } from "@/lib/adapters/filmNoir";
import { genericJsonLdAdapter } from "@/lib/adapters/genericJsonLd";
import { ifcCenterAdapter } from "@/lib/adapters/ifcCenter";
import { lowCinemaAdapter } from "@/lib/adapters/lowCinema";
import { mayslesAdapter } from "@/lib/adapters/maysles";
import { metrographAdapter } from "@/lib/adapters/metrograph";
import { momaAdapter } from "@/lib/adapters/moma";
import { movingImageAdapter } from "@/lib/adapters/movingImage";
import { nitehawkAdapter } from "@/lib/adapters/nitehawk";
import { parisTheaterAdapter } from "@/lib/adapters/parisTheater";
import { quadCinemaAdapter } from "@/lib/adapters/quadCinema";
import { roxyAdapter } from "@/lib/adapters/roxy";
import { spectacleAdapter } from "@/lib/adapters/spectacle";
import { syndicatedAdapter } from "@/lib/adapters/syndicated";
import { Film, Venue } from "@/lib/domain";

const adapters: VenueAdapter[] = [
  amcImaxAdapter,
  angelikaAdapter,
  bamAdapter,
  filmForumAdapter,
  filmNoirAdapter,
  lowCinemaAdapter,
  ifcCenterAdapter,
  quadCinemaAdapter,
  metrographAdapter,
  mayslesAdapter,
  momaAdapter,
  parisTheaterAdapter,
  roxyAdapter,
  nitehawkAdapter,
  spectacleAdapter,
  syndicatedAdapter,
  movingImageAdapter,
  genericJsonLdAdapter
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
