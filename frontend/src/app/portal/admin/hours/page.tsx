import type { Metadata } from "next";

import { HoursManager } from "@/components/admin/HoursManager";

export const metadata: Metadata = { title: "Hours" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Hours</h1>
      <HoursManager />
    </div>
  );
}
