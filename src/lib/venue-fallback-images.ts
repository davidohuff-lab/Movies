import { Venue } from "@/lib/domain";

const VENUE_FALLBACK_IMAGES: Record<string, string> = {
  "anthology-film-archives": "https://www.anthologyfilmarchives.org/images/logo.jpg",
  "bam-rose-cinemas": "https://i.ytimg.com/vi/hdiSucS0ebc/maxresdefault.jpg",
  "film-at-lincoln-center": "https://as.nyu.edu/content/dam/nyu-as/maisonFrancaise/images/FLC.png",
  "moma-film-screenings": "/moma-logo.png",
  "spectacle-theater": "https://upload.wikimedia.org/wikipedia/commons/1/1d/Spectacle_Theater_Logo.jpg"
};

export function shouldUseVenueImageOnly(venue: Venue): boolean {
  return venue.slug === "moma-film-screenings";
}

export function getVenueFallbackImageUrl(venue: Venue): string | null {
  const explicitImage = VENUE_FALLBACK_IMAGES[venue.slug];
  if (explicitImage) {
    return explicitImage;
  }

  try {
    const hostname = new URL(venue.website).hostname.replace(/^www\./i, "");
    return `https://logo.clearbit.com/${hostname}`;
  } catch {
    return null;
  }
}
