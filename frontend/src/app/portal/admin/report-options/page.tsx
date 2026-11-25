import type { Metadata } from "next";

import { ReportOptionsManager } from "@/components/admin/ReportOptionsManager";

export const metadata: Metadata = { title: "Report options" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Report options</h1>
      <ReportOptionsManager />
    </div>
  );
}
