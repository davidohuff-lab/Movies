import { CalendarView } from "@/components/calendar-view";
import { getPublicDataset } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const dataset = await getPublicDataset();
  return <CalendarView dataset={dataset} />;
}
