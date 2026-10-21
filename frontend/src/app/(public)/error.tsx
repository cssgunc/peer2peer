"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function PublicError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p>We couldn&apos;t load this page. Please try again or return home.</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={retry} className="min-h-11 px-4">
          Try again
        </Button>
        <Button asChild variant="outline" className="min-h-11 px-4">
          <Link href="/">Return home</Link>
        </Button>
      </div>
      <p>For emergencies, call 911. For crisis support, call or text 988.</p>
    </div>
  );
}
