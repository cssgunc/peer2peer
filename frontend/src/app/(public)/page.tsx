import HoursList, { type Hours } from "@/components/content/HoursList";
import Markdown from "@/components/content/Markdown";
import { Button } from "@/components/ui/button";
import { getPublicData } from "@/lib/public-data";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

type SiteSettings = {
  tagline: string;
};

type ContentBlock = {
  slug: string;
  title: string;
  body_md: string;
  updated_at: string | null;
};

export const metadata: Metadata = {
  title: "Home",
};

async function HomeContent() {
  await connection();
  const [settings, intro, howItWorks, whatIsPeerSupport, hours] =
    await Promise.all([
      getPublicData<SiteSettings>("/api/settings", "settings"),
      getPublicData<ContentBlock>("/api/content/home.intro", "content"),
      getPublicData<ContentBlock>("/api/content/home.how-it-works", "content"),
      getPublicData<ContentBlock>(
        "/api/content/home.what-is-peer-support",
        "content",
      ),
      getPublicData<Hours>("/api/hours", "hours"),
    ]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col items-center gap-4 px-6 text-center">
        <h1 className="text-3xl font-semibold">{intro.title}</h1>
        <p className="max-w-md text-lg">{settings.tagline}</p>
        <Markdown>{intro.body_md}</Markdown>
      </section>

      <nav className="mb-12 flex flex-col gap-3 px-14 sm:flex-row sm:justify-center">
        <Button asChild className="min-h-11 w-full sm:w-auto">
          <Link href="/text-us">Start a conversation</Link>
        </Button>

        <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
          <Link href="/resources">Find resources</Link>
        </Button>
      </nav>

      <section>
        <h2 className="mb-4 text-2xl font-semibold">Hours</h2>
        <HoursList hours={hours} />
      </section>

      {/* Impact stats and countdown will go here. */}

      <section>
        <h2 className="mb-4 text-2xl font-semibold">{howItWorks.title}</h2>
        <Markdown>{howItWorks.body_md}</Markdown>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-semibold">
          {whatIsPeerSupport.title}
        </h2>
        <Markdown>{whatIsPeerSupport.body_md}</Markdown>
      </section>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={
        <div>
          <h1>Peer2Peer</h1>
          <p>Loading...</p>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
