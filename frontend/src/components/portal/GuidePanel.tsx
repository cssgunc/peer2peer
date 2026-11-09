"use client";

import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

import { GuideContent } from "./GuideContent";

export function GuidePanel() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" className="min-h-11">
          Guide
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:w-[min(40rem,90vw)] data-[side=right]:sm:max-w-none"
      >
        <GuideContent inPanel />
        <SheetClose asChild>
          <Button
            variant="ghost"
            className="absolute top-4 right-4 min-h-11"
            aria-label="Close guide"
          >
            <XIcon aria-hidden="true" />
            Close
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
