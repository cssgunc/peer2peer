import type { Metadata } from "next";

import { ResourcesManager } from "@/components/admin/ResourcesManager";

export const metadata: Metadata = { title: "Resources" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Resources</h1>
      <ResourcesManager />
    </div>
  );
}
