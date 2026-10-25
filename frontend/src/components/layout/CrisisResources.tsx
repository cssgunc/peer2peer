import { connection } from "next/server";

import { getPublicData } from "@/lib/public-data";

type CrisisResource = {
  id: string;
  name: string;
  url: string | null;
  phone: string | null;
  is_crisis: boolean;
};

// Shown when the API fails or has no crisis resources, and while loading.
const FALLBACK_RESOURCES: CrisisResource[] = [
  {
    id: "fallback-911",
    name: "Emergency Services",
    url: null,
    phone: "911",
    is_crisis: true,
  },
  {
    id: "fallback-988",
    name: "988 Suicide & Crisis Lifeline",
    url: "https://988lifeline.org",
    phone: "988",
    is_crisis: true,
  },
];

const linkClassName =
  "flex min-h-11 items-center rounded-sm py-2 text-sm break-all underline underline-offset-4";

function CrisisResourceList({ resources }: { resources: CrisisResource[] }) {
  return (
    <section aria-labelledby="crisis-resources-heading" className="mt-6">
      <h2 id="crisis-resources-heading" className="font-semibold">
        In crisis? Get help now
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Peer2Peer is not a crisis service. If you or someone else is in danger,
        contact one of these resources right away.
      </p>
      <ul className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-8">
        {resources.map((resource) => {
          const phone = resource.phone?.trim();
          const url = resource.url?.trim();
          return (
            <li key={resource.id}>
              <p className="text-sm font-medium">{resource.name}</p>
              {phone && (
                <a
                  href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                  className={linkClassName}
                >
                  {phone}
                </a>
              )}
              {url && /^https?:\/\//i.test(url) && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={linkClassName}
                >
                  {url.replace(/^https?:\/\//i, "").replace(/\/$/, "")}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function CrisisResourcesFallback() {
  return <CrisisResourceList resources={FALLBACK_RESOURCES} />;
}

export default async function CrisisResources() {
  await connection();
  let resources: CrisisResource[];
  try {
    resources = await getPublicData<CrisisResource[]>(
      "/api/resources",
      "resources",
    );
  } catch {
    return <CrisisResourcesFallback />;
  }

  const crisisResources = resources.filter((resource) => resource.is_crisis);
  if (crisisResources.length === 0) {
    return <CrisisResourcesFallback />;
  }
  return <CrisisResourceList resources={crisisResources} />;
}
