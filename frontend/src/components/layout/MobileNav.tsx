"use client";

import { MenuIcon, XIcon } from "lucide-react";
import { useState } from "react";

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

import { NavLinks } from "./NavLinks";

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="min-h-11 gap-2 px-3 md:hidden"
          aria-label="Open navigation menu"
        >
          <MenuIcon aria-hidden="true" />
          Menu
        </Button>
      </SheetTrigger>
      <SheetContent
        showCloseButton={false}
        className="gap-6 overflow-y-auto p-6"
      >
        <SheetHeader className="p-0 pr-10">
          <SheetTitle>Peer2Peer menu</SheetTitle>
          <SheetDescription className="sr-only">
            Explore the site or text us for peer support.
          </SheetDescription>
        </SheetHeader>
        <nav aria-label="Mobile">
          <NavLinks mobile onNavigate={() => setOpen(false)} />
        </nav>
        <SheetClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-3 right-3 min-h-11 min-w-11"
            aria-label="Close navigation menu"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
