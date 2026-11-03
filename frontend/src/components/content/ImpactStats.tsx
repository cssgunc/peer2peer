import type { components } from "@/lib/api-types";
import { getPublicData } from "@/lib/public-data";

export type Statistic = components["schemas"]["StatisticDTO"];

/** Published impact numbers (TDD 4.3.1). Renders nothing until a coordinator publishes one. */
export default async function ImpactStats() {
  const stats = await getPublicData<Statistic[]>(
    "/api/statistics",
    "statistics",
  );
  if (stats.length === 0) return null;

  return (
    <section aria-labelledby="impact-heading">
      <h2 id="impact-heading" className="mb-4 text-2xl font-semibold">
        Our impact
      </h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {stats.map((stat) => (
          <div
            key={stat.id}
            className="flex flex-col-reverse justify-end rounded-lg border bg-card p-4 text-center"
          >
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="text-3xl font-semibold">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
