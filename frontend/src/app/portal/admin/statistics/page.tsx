import type { Metadata } from "next";

import { StatisticsManager } from "@/components/admin/StatisticsManager";

export const metadata: Metadata = { title: "Statistics" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Statistics</h1>
      <StatisticsManager />
    </div>
  );
}
