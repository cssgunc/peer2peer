import type { Metadata } from "next";
import { connection } from "next/server";

import Markdown from "@/components/content/Markdown";
import { getPublicData } from "@/lib/public-data";

export const metadata: Metadata = { title: "About" };

type ContentBlock = {
  slug: string;
  title: string;
  body_md: string;
};

const ABOUT_SLUGS = ["about.history", "about.pillars", "about.training"];

export default async function AboutPage() {
  await connection();
  const blocks = await Promise.all(
    ABOUT_SLUGS.map((slug) =>
      getPublicData<ContentBlock>(`/api/content/${slug}`, "content"),
    ),
  );

  return (
    <div className="max-w-3xl space-y-10">
      <h1 className="text-3xl font-semibold tracking-tight">About</h1>
      {blocks.map((block) => (
        <section
          key={block.slug}
          aria-labelledby={block.slug}
          className="space-y-4"
        >
          <h2 id={block.slug} className="text-2xl font-semibold tracking-tight">
            {block.title}
          </h2>
          <Markdown>{block.body_md}</Markdown>
        </section>
      ))}
    </div>
  );
}
