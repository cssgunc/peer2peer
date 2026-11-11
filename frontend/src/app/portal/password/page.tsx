import type { Metadata } from "next";

import { ChangePasswordForm } from "@/components/portal/ChangePasswordForm";

export const metadata: Metadata = { title: "Change password" };

export default function ChangePasswordPage() {
  return (
    <section className="flex max-w-md flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Change password</h1>
      <ChangePasswordForm />
    </section>
  );
}
