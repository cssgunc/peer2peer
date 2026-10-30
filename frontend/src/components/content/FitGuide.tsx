import type { components } from "@/lib/api-types";

type FitGuideResource = Pick<
  components["schemas"]["ResourceDTO"],
  "id" | "name" | "url" | "phone"
>;

type FitGuideItem = {
  id: string;
  text: string;
  resource_id: string | null;
  resource: FitGuideResource | null;
};

export type FitGuideData = {
  good_fit: FitGuideItem[];
  other_resource: FitGuideItem[];
};

function ResourceLink({ resource }: { resource: FitGuideResource | null }) {
  if (!resource) return null;

  const url = resource.url?.trim();
  const website = url && /^https?:\/\//i.test(url) ? url : null;
  const phone = resource.phone?.trim();
  const telephone = phone?.replace(/[^\d+]/g, "");
  const href = website ?? (telephone ? `tel:${telephone}` : null);
  if (!href) return null;

  return (
    <a
      href={href}
      target={website ? "_blank" : undefined}
      rel={website ? "noopener noreferrer" : undefined}
      className="inline-flex min-h-11 max-w-full items-center rounded-sm py-2 text-sm font-medium break-words text-primary underline underline-offset-4"
    >
      {website ? resource.name : `${resource.name}: ${phone}`}
    </a>
  );
}

export default function FitGuide({ guide }: { guide: FitGuideData }) {
  const columns = [
    {
      title: "Peer2Peer is a good fit if...",
      items: guide.good_fit,
    },
    {
      title: "Another resource may be better if...",
      items: guide.other_resource,
    },
  ];

  return (
    <section aria-labelledby="fit-guide-heading" className="space-y-6">
      <h2
        id="fit-guide-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Is Peer2Peer right for me?
      </h2>
      <div className="grid gap-6 md:grid-cols-2">
        {columns.map(({ title, items }) => (
          <div key={title} className="min-w-0 space-y-4 rounded-lg border p-5">
            <h3 className="text-lg font-semibold">{title}</h3>
            <ul aria-label={title} className="list-disc space-y-4 pl-5">
              {items.map((item) => (
                <li key={item.id} className="break-words">
                  <p>{item.text}</p>
                  <ResourceLink resource={item.resource} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
