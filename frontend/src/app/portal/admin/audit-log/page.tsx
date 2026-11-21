import type { Metadata } from "next";
import { Suspense } from "react";

import { AuditLogTable } from "@/components/admin/AuditLogTable";

export const metadata: Metadata = { title: "Audit log" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit Log</h1>
      <Suspense fallback={<p role="status">Loading audit log...</p>}>
        <AuditLogTable />
      </Suspense>
    </div>
  );
}
