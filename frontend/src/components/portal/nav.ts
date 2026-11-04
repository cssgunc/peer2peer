import type { Me } from "@/lib/portal/queries";

export type PortalNavItem = {
  label: string;
  href: string;
  coordinatorOnly: boolean;
};

export const portalNav: PortalNavItem[] = [
  { label: "Inbox", href: "/portal", coordinatorOnly: false },
  { label: "Guide", href: "/portal/guide", coordinatorOnly: false },
  { label: "Accounts", href: "/portal/admin/accounts", coordinatorOnly: true },
  { label: "Content", href: "/portal/admin/content", coordinatorOnly: true },
  { label: "Hours", href: "/portal/admin/hours", coordinatorOnly: true },
  {
    label: "Resources",
    href: "/portal/admin/resources",
    coordinatorOnly: true,
  },
  { label: "FAQs", href: "/portal/admin/faqs", coordinatorOnly: true },
  {
    label: "Statistics",
    href: "/portal/admin/statistics",
    coordinatorOnly: true,
  },
  {
    label: "Report options",
    href: "/portal/admin/report-options",
    coordinatorOnly: true,
  },
  { label: "Feedback", href: "/portal/admin/feedback", coordinatorOnly: true },
  {
    label: "Analytics",
    href: "/portal/admin/analytics",
    coordinatorOnly: true,
  },
  {
    label: "Audit log",
    href: "/portal/admin/audit-log",
    coordinatorOnly: true,
  },
  {
    label: "Escalations",
    href: "/portal/admin/escalations",
    coordinatorOnly: true,
  },
];

export function navFor(role: Me["role"]) {
  return portalNav.filter(
    (item) => !item.coordinatorOnly || role === "coordinator",
  );
}
