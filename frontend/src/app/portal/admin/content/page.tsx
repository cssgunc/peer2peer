import type { Metadata } from "next";

import { Placeholder } from "@/components/portal/Placeholder";

export const metadata: Metadata = { title: "Content" };

export default function Page() {
  return <Placeholder title="Content" />;
}
