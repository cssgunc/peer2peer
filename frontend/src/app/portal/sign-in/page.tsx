import type { Metadata } from "next";
import { Suspense } from "react";

import { IdleSignOutNotice } from "@/components/portal/IdleSignOutNotice";
import { SignInForm } from "@/components/portal/SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main
      id="main-content"
      className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12"
    >
      <h1 className="text-2xl font-semibold tracking-tight">
        Sign in to the Peer2Peer portal
      </h1>
      {/* Reading the query string in the browser keeps this page static. */}
      <Suspense fallback={null}>
        <IdleSignOutNotice />
      </Suspense>
      <SignInForm />
    </main>
  );
}
