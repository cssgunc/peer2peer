"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { Me } from "@/lib/portal/queries";

import { navFor } from "./nav";

export function PortalNavLinks({
  role,
  onNavigate,
}: {
  role: Me["role"];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = navFor(role);
  const groups = [
    { heading: null, items: items.filter((item) => !item.coordinatorOnly) },
    { heading: "Admin", items: items.filter((item) => item.coordinatorOnly) },
  ].filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ heading, items }) => (
        <div key={heading ?? "main"} className="flex flex-col gap-1">
          {heading && (
            <p className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {heading}
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {items.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  onClick={onNavigate}
                  className="flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-muted aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
