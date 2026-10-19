import type { NextConfig } from "next";
import { BACKEND_URL } from "./src/lib/backend-url";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
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
