import type { Metadata } from "next";

import { GuideContent } from "@/components/portal/GuideContent";

export const metadata: Metadata = { title: "Guide" };

export default function Page() {
  return (
    <section className="flex max-w-3xl min-w-0 flex-col gap-6">
      <GuideContent />
    </section>
  );
}
