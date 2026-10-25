import { connection } from "next/server";

import { Button } from "@/components/ui/button";
import { getPublicData } from "@/lib/public-data";

type ContactSettings = {
  contact_email: string;
  instagram_handle: string;
  responder_form_url: string | null;
};

export default async function ContactDetails({
  showResponderForm = false,
}: {
  showResponderForm?: boolean;
}) {
  await connection();
  let settings: ContactSettings;
  try {
    settings = await getPublicData<ContactSettings>(
      "/api/settings",
      "settings",
    );
  } catch {
    return (
      <p className="text-sm text-muted-foreground">
        Contact details are temporarily unavailable. Please try again later.
      </p>
    );
  }

  const email = settings.contact_email.trim();
  const handle = settings.instagram_handle.trim().replace(/^@/, "");
  const responderFormUrl = settings.responder_form_url?.trim();

  return (
    <div className="flex flex-col items-start gap-4">
      <nav
        aria-label="Contact"
        className="flex flex-col items-start gap-1 sm:flex-row sm:gap-6"
      >
        {email && (
          <a
            href={`mailto:${email}`}
            className="flex min-h-11 items-center rounded-sm py-2 text-sm break-all underline underline-offset-4"
          >
            {email}
          </a>
        )}
        {handle && (
          <a
            href={`https://www.instagram.com/${encodeURIComponent(handle)}/`}
            className="flex min-h-11 items-center rounded-sm py-2 text-sm break-all underline underline-offset-4"
          >
            Instagram (@{handle})
          </a>
        )}
      </nav>
      {showResponderForm && responderFormUrl && (
        <Button asChild className="h-auto min-h-11 py-3 whitespace-normal">
          <a href={responderFormUrl} target="_blank" rel="noopener noreferrer">
            Become a Peer Responder
          </a>
        </Button>
      )}
    </div>
  );
}
