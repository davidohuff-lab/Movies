import { SearchExperience } from "@/components/search-experience";
import { getPublicDataset } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dataset = await getPublicDataset();
  return <SearchExperience dataset={dataset} />;
}
