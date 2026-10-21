"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

const links = [
  { href: "/", label: "Home" },
  { href: "/faq", label: "FAQ" },
  { href: "/resources", label: "Resources" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/text-us", label: "Text Us" },
];

export function NavLinks({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <ul
      className={cn("flex gap-1", mobile ? "flex-col gap-2" : "items-center")}
    >
      {links.map(({ href, label }) => (
        <li key={href}>
          {href === "/text-us" ? (
            <Button asChild className={cn("min-h-11 px-4", mobile && "w-full")}>
              <Link
                href={href}
                aria-current={pathname === href ? "page" : undefined}
                onClick={onNavigate}
              >
                {label}
              </Link>
            </Button>
          ) : (
            <Link
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              onClick={onNavigate}
              className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-muted aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground"
            >
              {label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
