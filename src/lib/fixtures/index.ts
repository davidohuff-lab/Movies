import { filmNoirIcsFixture } from "@/lib/fixtures/filmNoirIcs";
import { ifcCenterHtmlFixture } from "@/lib/fixtures/ifcCenterHtml";
import { lowCinemaHtmlFixture } from "@/lib/fixtures/lowCinemaHtml";
import { movingImageHtmlFixture } from "@/lib/fixtures/movingImageHtml";
import { spectacleHtmlFixture } from "@/lib/fixtures/spectacleHtml";

export const fixtureByVenueSlug: Record<string, string> = {
  "film-noir-cinema": filmNoirIcsFixture,
  "low-cinema": lowCinemaHtmlFixture,
  "ifc-center": ifcCenterHtmlFixture,
  "spectacle-theater": spectacleHtmlFixture,
  "museum-of-the-moving-image": movingImageHtmlFixture
};
