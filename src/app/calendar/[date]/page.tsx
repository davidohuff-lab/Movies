import { notFound } from "next/navigation";

import { CalendarDayView } from "@/components/calendar-day-view";
import { getPublicDataset } from "@/lib/repository";

export const dynamic = "force-dynamic";

interface CalendarDayPageProps {
  params: Promise<{ date: string }>;
}

export default async function CalendarDayPage({ params }: CalendarDayPageProps) {
  const resolved = await params;
  const day = resolved.date;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    notFound();
  }

  const dataset = await getPublicDataset();
  return <CalendarDayView dataset={dataset} day={day} />;
}
