import ImpactStats, { type Statistic } from "./ImpactStats";
import { getPublicData } from "@/lib/public-data";

/** Keep public caching out of the shared presentation used by the portal. */
export default async function PublishedImpactStats() {
  const stats = await getPublicData<Statistic[]>(
    "/api/statistics",
    "statistics",
  );
  return <ImpactStats stats={stats} />;
}
