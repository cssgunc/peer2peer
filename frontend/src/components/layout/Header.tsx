import Link from "next/link";

import { MobileNav } from "./MobileNav";
import { NavLinks } from "./NavLinks";

export function Header() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-sm text-xl font-semibold tracking-tight"
        >
          Peer2Peer
        </Link>
        <nav aria-label="Primary" className="hidden md:block">
          <NavLinks />
        </nav>
        <MobileNav />
      </div>
    </header>
  );
}
