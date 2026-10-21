import Link from "next/link";

import { Button } from "@/components/ui/button";

import PublicLayout from "./(public)/layout";

export default function NotFound() {
  return (
    <PublicLayout>
      <div className="max-w-xl space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">
          Page not found
        </h1>
        <p>
          We couldn&apos;t find this page. You can return home to keep browsing.
        </p>
        <Button asChild className="min-h-11 px-4">
          <Link href="/">Return home</Link>
        </Button>
        <p>For emergencies, call 911. For crisis support, call or text 988.</p>
      </div>
    </PublicLayout>
  );
}
