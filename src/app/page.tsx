import { CalendarView } from "@/components/calendar-view";
import { getPublicDataset } from "@/lib/repository";

export const revalidate = 86400;
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const dataset = await getPublicDataset();
  return <CalendarView dataset={dataset} />;
}
