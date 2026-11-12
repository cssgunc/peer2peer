import type { Metadata } from "next";

import { AccountsManager } from "@/components/admin/AccountsManager";

export const metadata: Metadata = { title: "Accounts" };

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Accounts</h1>
      <AccountsManager />
    </div>
  );
}
