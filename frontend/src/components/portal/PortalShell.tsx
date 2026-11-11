"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MenuIcon, XIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useMe } from "@/lib/portal/queries";

import { GuidePanel } from "./GuidePanel";
import { IdleWarning } from "./IdleWarning";
import { PortalNavLinks } from "./PortalNavLinks";
import { ShiftToggle } from "./ShiftToggle";

export function PortalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // The sign-in page renders bare; fetching /me there would 401 and redirect back to itself.
  if (pathname === "/portal/sign-in") {
    return <>{children}</>;
  }
  return <SignedInShell>{children}</SignedInShell>;
}

function SignedInShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await apiFetch("/api/auth/sign-out", { method: "POST" });
    } finally {
      // Clear even if the request failed, so the next person on a shared computer never sees this account's data.
      queryClient.clear();
      router.push("/portal/sign-in");
    }
  }

  // A failed /me redirects through the QueryCache handler; show nothing until it settles.
  if (!me) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/* Here rather than in layout.tsx, so it never runs on the sign-in page. */}
      <IdleWarning />
      <header className="border-b bg-background">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="min-h-11 min-w-11 md:hidden"
                  aria-label="Open portal menu"
                >
                  <MenuIcon aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                showCloseButton={false}
                className="gap-6 overflow-y-auto p-6"
              >
                <SheetHeader className="p-0 pr-10">
                  <SheetTitle>Portal menu</SheetTitle>
                  <SheetDescription>
                    Signed in as {me.display_name}
                  </SheetDescription>
                </SheetHeader>
                <nav aria-label="Portal mobile">
                  <PortalNavLinks
                    role={me.role}
                    onNavigate={() => setMenuOpen(false)}
                  />
                </nav>
                <SheetClose asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-3 right-3 min-h-11 min-w-11"
                    aria-label="Close portal menu"
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </SheetClose>
              </SheetContent>
            </Sheet>
            <span className="text-lg font-semibold tracking-tight">
              Peer2Peer Portal
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <ShiftToggle />
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {me.display_name}
            </span>
            <GuidePanel />
            <Button
              variant="outline"
              className="min-h-11"
              onClick={signOut}
              disabled={signingOut}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="hidden w-56 shrink-0 border-r p-4 md:block">
          <nav aria-label="Portal">
            <PortalNavLinks role={me.role} />
          </nav>
        </aside>
        <main
          id="main-content"
          tabIndex={-1}
          className="w-full flex-1 px-4 py-8 sm:px-6"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
