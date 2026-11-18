import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

const PRIVATE = [
  { key: "Cache-Control", value: "no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

describe("next.config headers", () => {
  it("marks /text-us and /portal/* no-store and no-referrer (TDD 4.8)", async () => {
    const rules = await nextConfig.headers!();
    const bySource = Object.fromEntries(
      rules.map((rule) => [rule.source, rule.headers]),
    );
    expect(bySource["/text-us"]).toEqual(PRIVATE);
    expect(bySource["/portal/:path*"]).toEqual(PRIVATE);
  });
});
