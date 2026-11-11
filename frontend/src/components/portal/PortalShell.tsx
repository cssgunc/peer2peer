"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

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
import {
  ConnectionIndicator,
  PortalSocketProvider,
} from "@/lib/portal/PortalSocketProvider";
import { useMe } from "@/lib/portal/queries";

import { GuidePanel } from "./GuidePanel";
import { PortalNavLinks } from "./PortalNavLinks";

const PASSWORD_PATH = "/portal/password";

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
  const pathname = usePathname();
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

  // The backend refuses every other route until a temporary password is replaced.
  const mustChangePassword = me?.must_change_password ?? false;
  const leavingPasswordPage = mustChangePassword && pathname !== PASSWORD_PATH;

  useEffect(() => {
    if (leavingPasswordPage) {
      router.replace(PASSWORD_PATH);
    }
  }, [leavingPasswordPage, router]);

  // A failed /me redirects through the QueryCache handler; show nothing until it settles.
  if (!me || leavingPasswordPage) {
    return null;
  }

  return (
    <PortalSocketProvider>
      <div className="flex min-h-full flex-1 flex-col">
        <header className="border-b bg-background">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:flex-nowrap sm:gap-4 sm:px-6">
            <div className="flex items-center gap-2">
              {!mustChangePassword && (
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
              )}
              <span className="text-lg font-semibold tracking-tight">
                Peer2Peer Portal
              </span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <ConnectionIndicator />
              <span className="hidden text-sm text-muted-foreground sm:inline">
                {me.display_name}
              </span>
              {!mustChangePassword && (
                <>
                  <GuidePanel />
                  <Button asChild variant="ghost" className="min-h-11">
                    <Link href={PASSWORD_PATH}>Change password</Link>
                  </Button>
                </>
              )}
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
          {!mustChangePassword && (
            <aside className="hidden w-56 shrink-0 border-r p-4 md:block">
              <nav aria-label="Portal">
                <PortalNavLinks role={me.role} />
              </nav>
            </aside>
          )}
          <main
            id="main-content"
            tabIndex={-1}
            className="w-full flex-1 px-4 py-8 sm:px-6"
          >
            {children}
          </main>
        </div>
      </div>
    </PortalSocketProvider>
  );
}
