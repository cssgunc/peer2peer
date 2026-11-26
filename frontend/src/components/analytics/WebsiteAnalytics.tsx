"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Keep dynamic paths and sensitive routes out of the analytics payload.
const TRACKED_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/faq",
  "/resources",
]);

type UmamiWindow = Window & {
  umami?: {
    track: (page: {
      website: string;
      hostname: string;
      url: string;
      referrer?: string;
    }) => Promise<unknown>;
  };
};

export function WebsiteAnalytics({
  scriptUrl,
  siteId,
}: {
  scriptUrl: string;
  siteId: string;
}) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!ready || !TRACKED_PATHS.has(pathname)) return;

    const referrer = document.referrer ? new URL(document.referrer) : null;
    const externalOrigin =
      referrer &&
      (referrer.protocol === "https:" || referrer.protocol === "http:") &&
      referrer.origin !== window.location.origin
        ? referrer.origin
        : undefined;

    // Send only the allowlisted path and the referring site's origin.
    void (window as UmamiWindow).umami?.track({
      website: siteId,
      hostname: window.location.hostname,
      url: pathname,
      referrer: externalOrigin,
    });
  }, [pathname, ready, siteId]);

  if (!TRACKED_PATHS.has(pathname)) return null;

  return (
    <Script
      src={scriptUrl}
      data-website-id={siteId}
      data-auto-track="false"
      referrerPolicy="no-referrer"
      onReady={() => setReady(true)}
    />
  );
}
