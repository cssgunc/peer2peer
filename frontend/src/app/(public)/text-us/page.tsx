import type { Metadata } from "next";
import { connection } from "next/server";

import LineStatusNotice from "@/components/chat/LineStatusNotice";
import TextUsChat from "@/components/chat/TextUsChat";
import Markdown from "@/components/content/Markdown";
import { getPublicData } from "@/lib/public-data";

export const metadata: Metadata = { title: "Text Us" };

type SiteSettings = {
  sms_number: string | null;
  channels: ("web" | "sms")[];
};

type ContentBlock = {
  slug: string;
  title: string;
  body_md: string;
};

/** Keeps only what an `sms:` URI needs: digits and a leading `+`. */
function smsHref(number: string) {
  return `sms:${number.replace(/[^\d+]/g, "")}`;
}

export default async function TextUsPage() {
  await connection();
  const [settings, intro, notice] = await Promise.all([
    getPublicData<SiteSettings>("/api/settings", "settings"),
    getPublicData<ContentBlock>("/api/content/text-us.intro", "content"),
    getPublicData<ContentBlock>("/api/content/chat.notice", "content"),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">{intro.title}</h1>
        <Markdown>{intro.body_md}</Markdown>
      </section>

      <LineStatusNotice />

      {settings.channels.includes("web") && (
        <TextUsChat notice={notice.body_md} />
      )}

      {settings.sms_number && (
        <p>
          You can also text us at{" "}
          <a
            href={smsHref(settings.sms_number)}
            className="font-semibold underline underline-offset-4"
          >
            {settings.sms_number}
          </a>
          .
        </p>
      )}
    </div>
  );
}
