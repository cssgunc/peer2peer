import type { Metadata } from "next";

import { FeedbackInbox } from "@/components/admin/FeedbackInbox";

export const metadata: Metadata = { title: "Feedback" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Feedback</h1>
      <FeedbackInbox />
    </div>
  );
}
