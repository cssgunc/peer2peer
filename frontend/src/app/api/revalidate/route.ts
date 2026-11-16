import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { isCacheTag } from "@/lib/cache-tags";

// The backend calls this after each admin save with the cache tags to drop (TDD 4.6.8).

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

// Hashing gives both sides the same length, so timingSafeEqual never throws and the
// comparison time doesn't depend on how much of the secret matched.
function secretMatches(given: string | null): boolean {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || !given) {
    return false;
  }
  return timingSafeEqual(sha256(given), sha256(expected));
}

export async function POST(request: Request) {
  // Check the secret before the body, so callers without it can't probe the tag list.
  if (!secretMatches(request.headers.get("x-revalidate-secret"))) {
    return new Response(null, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const tags =
    typeof body === "object" && body !== null && "tags" in body
      ? body.tags
      : undefined;
  if (!Array.isArray(tags) || tags.length === 0 || !tags.every(isCacheTag)) {
    return new Response(null, { status: 400 });
  }

  for (const tag of new Set(tags)) {
    // Expire now: the backend is a webhook caller, so updateTag isn't available, and
    // "max" would serve one more stale page after a coordinator's edit.
    revalidateTag(tag, { expire: 0 });
  }
  return new Response(null, { status: 204 });
}
