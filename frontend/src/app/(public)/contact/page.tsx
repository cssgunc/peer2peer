import type { Metadata } from "next";
import { Suspense } from "react";

import ContactDetails from "@/components/content/ContactDetails";
import FeedbackForm from "@/components/content/FeedbackForm";

export const metadata: Metadata = { title: "Contact" };

export default function ContactPage() {
  return (
    <div className="max-w-3xl space-y-10">
      <h1 className="text-3xl font-semibold tracking-tight">Contact</h1>
      <section aria-labelledby="feedback-heading" className="space-y-4">
        <h2
          id="feedback-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Anonymous feedback
        </h2>
        <p className="text-muted-foreground">
          Share your thoughts about Peer2Peer and help us improve.
        </p>
        <FeedbackForm />
      </section>
      <section aria-labelledby="contact-heading" className="space-y-4">
        <h2
          id="contact-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Get in touch
        </h2>
        <Suspense fallback={<p role="status">Loading contact details…</p>}>
          <ContactDetails showResponderForm />
        </Suspense>
      </section>
    </div>
  );
}
