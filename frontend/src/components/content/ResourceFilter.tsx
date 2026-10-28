"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMemo, useState } from "react";
import ResourceCard, { type Resource, type ResourceTag } from "./ResourceCard";

type Scope = "all" | "unc" | "national";

export default function ResourceFilter({
  resources,
  tags,
}: {
  resources: Resource[];
  tags: ResourceTag[];
}) {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>("all");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return resources.filter((r) => {
      if (
        selectedTags.length > 0 &&
        !r.tags.some((t) => selectedTags.includes(t))
      )
        return false;
      if (scope === "unc" && !r.is_unc) return false;
      if (scope === "national" && r.is_unc) return false;
      if (!q) return true;
      return [r.name, r.description, ...r.tags].some((s) =>
        s.toLowerCase().includes(q),
      );
    });
  }, [resources, selectedTags, scope, query]);

  function toggleTag(name: string) {
    setSelectedTags((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  function clearFilters() {
    setSelectedTags([]);
    setScope("all");
    setQuery("");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Input
          type="search"
          aria-label="Search resources"
          placeholder="Search resources"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <ToggleGroup
          type="single"
          variant="outline"
          aria-label="Filter by location"
          value={scope}
          onValueChange={(v) => {
            if (v) setScope(v as Scope);
          }}
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="unc">UNC</ToggleGroupItem>
          <ToggleGroupItem value="national">National</ToggleGroupItem>
        </ToggleGroup>

        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filter by tag"
        >
          {tags.map((tag) => {
            const selected = selectedTags.includes(tag.name);
            return (
              <Badge
                key={tag.id}
                asChild
                variant={selected ? "default" : "outline"}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleTag(tag.name)}
                >
                  {tag.name}
                </button>
              </Badge>
            );
          })}
        </div>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {visible.length} of {resources.length} resources
      </p>

      {visible.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {visible.map((r) => (
            <ResourceCard key={r.id} resource={r} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p>No resources match</p>
          <Button variant="outline" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
