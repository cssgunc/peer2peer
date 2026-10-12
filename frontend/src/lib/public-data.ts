/** Example for public pages that fetch back end data.
 *
 * CI runs `next build` without the backend.
 * To aviod fetching during prerendering, wait for request before loading data.
 *
 * Copy this pattern below into a Next.js page (.tsx file)
 */

/*
import { Suspense } from "react";
import { connection } from "next/server";
import { getPublicData } from "@/lib/public-data";

type Example = {
  ex1: string;
  ex2: number;
}

async function PublicData() {
  await connection();
  const data = await getPublicData<Example[]>(
    "/api/examples",
    "examples"
  );
  return (
    <pre>{JSON.stringify(data, null, 2)}</pre>;
  );
}

export default function Page() {
  return (
  <Suspense fallback={<p>Loading example...</p>}>
    <PublicData />
  </Suspense>
  );
}
*/

import { cacheLife, cacheTag } from "next/cache";

export async function getPublicData<T>(path: string, tag: string) {
  "use cache";
  cacheTag(tag);
  cacheLife("hours");

  const result = await fetch(path);
  const data = await result.json();
  return data as T;
}
