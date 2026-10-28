import type { Resource, ResourceTag } from "@/components/content/ResourceCard";
import ResourceFilter from "@/components/content/ResourceFilter";
import { getPublicData } from "@/lib/public-data";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

export const metadata: Metadata = { title: "Resources" };

async function ResourcesContent() {
  await connection();
  const [resources, tags] = await Promise.all([
    getPublicData<Resource[]>("/api/resources", "resources"),
    getPublicData<ResourceTag[]>("/api/resource-tags", "resources"),
  ]);
  return <ResourceFilter resources={resources} tags={tags} />;
}

export default function ResourcesPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Resources</h1>
      <Suspense fallback={<p>Loading resources…</p>}>
        <ResourcesContent />
      </Suspense>
    </div>
  );
}
