import { Badge } from "@/components/ui/badge";
import type { components } from "@/lib/api-types";
export type Resource = components["schemas"]["ResourceDTO"];
export type ResourceTag = components["schemas"]["ResourceTagDTO"];

export default function ResourceCard({ resource }: { resource: Resource }) {
  const { name, description, url, phone, tags } = resource;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border p-4">
      <h3 className="text-lg font-semibold">{name}</h3>
      <p className="break-words text-muted-foreground">{description}</p>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {(url || phone) && (
        <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium break-all underline underline-offset-4"
            >
              Visit website
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone.replace(/[^\d+]/g, "")}`}
              className="font-medium underline underline-offset-4"
            >
              {phone}
            </a>
          )}
        </div>
      )}
    </li>
  );
}
