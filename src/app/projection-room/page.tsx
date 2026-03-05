import { AdminConsole } from "@/components/admin-console";
import { AdminGate } from "@/components/admin-gate";
import { getRegisteredAdapters, getVenueHealth } from "@/lib/adapters/registry";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getPublicDataset } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ProjectionRoomPage() {
  if (!isAdminAuthenticated()) {
    return <AdminGate />;
  }

  const dataset = await getPublicDataset();
  const activeHealth = await Promise.all(
    dataset.venues
      .filter((venue) => getRegisteredAdapters().some((adapter) => adapter.canHandle(venue)))
      .map(async (venue) => {
        const health = await getVenueHealth(venue, dataset.films);
        return {
          venue: venue.name,
          status: health.ok ? "ok" : "error",
          count: health.count,
          detail: health.detail
        };
      })
  );

  const adapters = getRegisteredAdapters().map((adapter) => ({ key: adapter.key, lane: adapter.lane }));

  return <AdminConsole dataset={dataset} health={activeHealth} adapters={adapters} />;
}
