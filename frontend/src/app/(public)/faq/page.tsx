import type { Metadata } from "next";
import { connection } from "next/server";

import FaqAccordion, { type Faq } from "@/components/content/FaqAccordion";
import FitGuide, { type FitGuideData } from "@/components/content/FitGuide";
import { getPublicData } from "@/lib/public-data";

export const metadata: Metadata = { title: "FAQ" };

export default async function FaqPage() {
  await connection();
  const [guide, faqs] = await Promise.all([
    getPublicData<FitGuideData>("/api/fit-guide", "fit-guide"),
    getPublicData<Faq[]>("/api/faqs", "faqs"),
  ]);

  return (
    <div className="max-w-5xl space-y-12">
      <h1 className="text-3xl font-semibold tracking-tight">FAQ</h1>
      <FitGuide guide={guide} />
      <FaqAccordion faqs={faqs} />
    </div>
  );
}
