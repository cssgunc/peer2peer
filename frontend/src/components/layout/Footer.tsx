import { Suspense } from "react";

import ContactDetails from "@/components/content/ContactDetails";
import CrisisResources, {
  CrisisResourcesFallback,
} from "@/components/layout/CrisisResources";

export function Footer() {
  return (
    <footer className="border-t bg-muted">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="font-semibold">Peer2Peer</p>
          <Suspense fallback={<p role="status">Loading contact details…</p>}>
            <ContactDetails />
          </Suspense>
        </div>
        <div id="crisis-resources">
          <Suspense fallback={<CrisisResourcesFallback />}>
            <CrisisResources />
          </Suspense>
        </div>
      </div>
    </footer>
  );
}
