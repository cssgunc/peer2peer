import { Suspense, type ReactNode } from "react";

import { WebsiteAnalytics } from "@/components/analytics/WebsiteAnalytics";

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { StatusBanner } from "@/components/layout/StatusBanner";

export default function PublicLayout({ children }: { children: ReactNode }) {
  const scriptUrl = process.env.WEBSITE_ANALYTICS_SCRIPT_URL?.trim();
  const siteId = process.env.WEBSITE_ANALYTICS_SITE_ID?.trim();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only rounded-md bg-background text-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <StatusBanner />
      <Header />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6"
      >
        {children}
      </main>
      <Footer />
      {scriptUrl && siteId && (
        <Suspense fallback={null}>
          <WebsiteAnalytics scriptUrl={scriptUrl} siteId={siteId} />
        </Suspense>
      )}
    </>
  );
}
