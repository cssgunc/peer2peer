import type { Metadata } from "next";

import { Placeholder } from "@/components/portal/Placeholder";

export const metadata: Metadata = { title: "Inbox" };

export default function Page() {
  return <Placeholder title="Inbox" />;
}
