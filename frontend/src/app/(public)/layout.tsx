import type { ReactNode } from "react";

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only rounded-md bg-background text-foreground focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:inline-flex focus:min-h-11 focus:items-center focus:px-4 focus:py-3"
      >
        Skip to content
      </a>
      <Header />
      {/* The shared StatusBanner will be added here in its own ticket. */}
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6"
      >
        {children}
      </main>
      <Footer />
    </>
  );
}
