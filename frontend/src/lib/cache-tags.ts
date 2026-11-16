/** Cache tags for public data (TDD 4.6.8). The backend sends these to /api/revalidate after admin saves. */
export const CACHE_TAGS = [
  "content",
  "faqs",
  "fit-guide",
  "hours",
  "resources",
  "settings",
  "statistics",
] as const;

export type CacheTag = (typeof CACHE_TAGS)[number];

export function isCacheTag(value: unknown): value is CacheTag {
  return (
    typeof value === "string" &&
    (CACHE_TAGS as readonly string[]).includes(value)
  );
}
