import { VenueBrowserView } from "@/components/venue-browser-view";
import { getPublicDataset } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function VenuesPage() {
  const dataset = await getPublicDataset();
  return <VenueBrowserView dataset={dataset} />;
}
