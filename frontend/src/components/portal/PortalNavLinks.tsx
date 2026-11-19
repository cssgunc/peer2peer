"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { type Me, useFeedbackUnreadCount } from "@/lib/portal/queries";

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
  // Responders get a 403 from the admin API, so never ask on their behalf.
  const { data: feedbackUnread } = useFeedbackUnreadCount({
    enabled: role === "coordinator",
  });
  const counts = { feedbackUnread };
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
            {items.map(({ href, label, badge }) => {
              const count = badge ? counts[badge] : undefined;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={pathname === href ? "page" : undefined}
                    onClick={onNavigate}
                    className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium hover:bg-muted aria-[current=page]:bg-secondary aria-[current=page]:text-secondary-foreground"
                  >
                    {label}
                    {!!count && (
                      <Badge className="ml-auto">
                        <span aria-hidden="true">{count}</span>
                        <span className="sr-only">{`, ${count} unread`}</span>
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
