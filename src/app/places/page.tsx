import { NearbyPlacesExplorer } from "@/components/nearby-places-explorer";

export const dynamic = "force-dynamic";

export default function PlacesPage({
  searchParams
}: {
  searchParams?: { theater?: string | string[] };
}) {
  const theaterParam = searchParams?.theater;
  const initialTheaterId = typeof theaterParam === "string" ? theaterParam : null;

  return <NearbyPlacesExplorer initialTheaterId={initialTheaterId} />;
}
