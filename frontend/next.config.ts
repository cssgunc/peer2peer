import type { NextConfig } from "next";
import { BACKEND_URL } from "./src/lib/backend-url";

// Pages that show conversations must never be cached or leak their URL in a
// Referer header (TDD 4.8).
const PRIVATE_PAGE_HEADERS = [
  { key: "Cache-Control", value: "no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  headers() {
    return [
      { source: "/text-us", headers: PRIVATE_PAGE_HEADERS },
      { source: "/portal/:path*", headers: PRIVATE_PAGE_HEADERS },
    ];
  },
  rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
      {
        source: "/ws/:path*",
        destination: `${BACKEND_URL}/ws/:path*`,
      },
    ];
  },
};

export default nextConfig;
