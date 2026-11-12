import type { Metadata } from "next";

import { EscalationRecords } from "@/components/portal/EscalationRecords";

export const metadata: Metadata = { title: "Escalations" };

export default function Page() {
  return <EscalationRecords />;
}
