"use client";

import Markdown from "@/components/content/Markdown";
import { Button } from "@/components/ui/button";
import {
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useGuide } from "@/lib/portal/queries";

export function GuideContent({ inPanel = false }: { inPanel?: boolean }) {
  const { data: guide, isPending, isError, refetch } = useGuide();
  const title = guide?.title ?? "Responder Guide";

  return (
    <>
      {inPanel ? (
        <SheetHeader className="shrink-0 p-6 pr-32">
          <SheetTitle className="text-2xl font-semibold tracking-tight">
            {title}
          </SheetTitle>
          <SheetDescription>
            Escalation protocol and responder resources.
          </SheetDescription>
        </SheetHeader>
      ) : (
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      )}
      <div
        className={
          inPanel ? "min-h-0 flex-1 overflow-y-auto px-6 pb-6" : undefined
        }
      >
        {isPending ? (
          <p role="status" className="text-muted-foreground">
            Loading guide…
          </p>
        ) : isError ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert">The guide could not be loaded. Please try again.</p>
            <Button variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <Markdown>{guide.body_md}</Markdown>
        )}
      </div>
    </>
  );
}
