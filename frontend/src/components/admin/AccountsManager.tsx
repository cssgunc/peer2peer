"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, apiFetch } from "@/lib/api";
import { type Me, useMe } from "@/lib/portal/queries";

type Role = Me["role"];

// Mirrors AccountDTO in backend/app/schemas/accounts.py.
export type Account = {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  last_login_at: string | null;
  on_shift: boolean;
};

type RoleFilter = "" | Role;
type ActiveFilter = "" | "true" | "false";

const accountsQueryKey = ["admin-accounts"] as const;

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30";

function errorMessage(error: unknown) {
  return error instanceof ApiError
    ? error.detail
    : "Something went wrong. Please try again.";
}

function sendJson<T>(path: string, method: string, body?: unknown) {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Runs one request with pending/error state. Deliberately not useMutation: a mutation's result
// stays in React Query's cache, and results here can hold a temporary password.
function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(request: () => Promise<T>): Promise<T | undefined> {
    setPending(true);
    setError(null);
    try {
      return await request();
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { pending, error, run };
}

type Dialogs =
  | { kind: "create" }
  | { kind: "edit"; account: Account }
  | { kind: "deactivate"; account: Account }
  | { kind: "reset"; account: Account }
  | null;

export function AccountsManager() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [role, setRole] = useState<RoleFilter>("");
  const [active, setActive] = useState<ActiveFilter>("");
  const [dialog, setDialog] = useState<Dialogs>(null);
  // Held only in component state, and cleared when its dialog closes.
  const [credential, setCredential] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: [...accountsQueryKey, { role, active }],
    queryFn: () => {
      const params = new URLSearchParams();
      if (role) params.set("role", role);
      if (active) params.set("is_active", active);
      const query = params.toString();
      return apiFetch<Account[]>(
        `/api/admin/accounts${query ? `?${query}` : ""}`,
      );
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: accountsQueryKey });

  async function reactivate(account: Account) {
    setRowError(null);
    try {
      await sendJson(`/api/admin/accounts/${account.id}`, "PATCH", {
        is_active: true,
      });
      await refresh();
    } catch (error) {
      setRowError(errorMessage(error));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <Label htmlFor="filter-role">Role</Label>
            <select
              id="filter-role"
              className={selectClass}
              value={role}
              onChange={(e) => setRole(e.target.value as RoleFilter)}
            >
              <option value="">All roles</option>
              <option value="responder">Responder</option>
              <option value="coordinator">Coordinator</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="filter-status">Status</Label>
            <select
              id="filter-status"
              className={selectClass}
              value={active}
              onChange={(e) => setActive(e.target.value as ActiveFilter)}
            >
              <option value="">All accounts</option>
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </select>
          </div>
        </div>
        <Button onClick={() => setDialog({ kind: "create" })}>
          New account
        </Button>
      </div>

      {rowError && <p role="alert">{rowError}</p>}

      {accounts.isPending ? (
        <p role="status">Loading accounts…</p>
      ) : accounts.isError ? (
        <div className="space-y-3">
          <p role="alert">Accounts could not be loaded.</p>
          <Button variant="outline" onClick={() => accounts.refetch()}>
            Try again
          </Button>
        </div>
      ) : accounts.data.length === 0 ? (
        <p>No accounts match these filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>On shift</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.data.map((account) => {
              const isSelf = account.id === me?.id;
              return (
                <TableRow key={account.id}>
                  <TableCell>
                    {account.display_name}
                    {isSelf && " (you)"}
                  </TableCell>
                  <TableCell>{account.email}</TableCell>
                  <TableCell className="capitalize">{account.role}</TableCell>
                  <TableCell>
                    <Badge variant={account.is_active ? "default" : "outline"}>
                      {account.is_active ? "Active" : "Deactivated"}
                    </Badge>
                  </TableCell>
                  <TableCell>{account.on_shift ? "Yes" : "No"}</TableCell>
                  <TableCell>
                    {account.last_login_at
                      ? new Date(account.last_login_at).toLocaleString()
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Edit ${account.display_name}`}
                        onClick={() => setDialog({ kind: "edit", account })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Reset password for ${account.display_name}`}
                        onClick={() => setDialog({ kind: "reset", account })}
                      >
                        Reset password
                      </Button>
                      {!isSelf &&
                        (account.is_active ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            aria-label={`Deactivate ${account.display_name}`}
                            onClick={() =>
                              setDialog({ kind: "deactivate", account })
                            }
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Reactivate ${account.display_name}`}
                            onClick={() => void reactivate(account)}
                          >
                            Reactivate
                          </Button>
                        ))}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {dialog?.kind === "create" && (
        <AccountFormDialog
          onClose={() => setDialog(null)}
          onSaved={(email, password) => {
            setDialog(null);
            setCredential({ email, password });
            void refresh();
          }}
        />
      )}
      {dialog?.kind === "edit" && (
        <AccountFormDialog
          account={dialog.account}
          isSelf={dialog.account.id === me?.id}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {dialog?.kind === "deactivate" && (
        <DeactivateDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {dialog?.kind === "reset" && (
        <ResetPasswordDialog
          account={dialog.account}
          onClose={() => setDialog(null)}
          onDone={(password) => {
            setDialog(null);
            setCredential({ email: dialog.account.email, password });
          }}
        />
      )}
      {credential && (
        <TemporaryPasswordDialog
          email={credential.email}
          password={credential.password}
          onClose={() => setCredential(null)}
        />
      )}
    </div>
  );
}

function AccountFormDialog({
  account,
  isSelf = false,
  onClose,
  onSaved,
}: {
  account?: Account;
  isSelf?: boolean;
  onClose: () => void;
  onSaved: (email: string, temporaryPassword: string) => void;
}) {
  const id = useId();
  const { pending, error, run } = useAction();
  const [email, setEmail] = useState(account?.email ?? "");
  const [displayName, setDisplayName] = useState(account?.display_name ?? "");
  const [role, setRole] = useState<Role>(account?.role ?? "responder");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (account) {
      // Send only what changed; the backend leaves omitted fields alone.
      const changes: { display_name?: string; role?: Role } = {};
      if (displayName.trim() !== account.display_name) {
        changes.display_name = displayName.trim();
      }
      if (role !== account.role) changes.role = role;
      const saved = await run(() =>
        Object.keys(changes).length === 0
          ? Promise.resolve(true)
          : sendJson(`/api/admin/accounts/${account.id}`, "PATCH", changes),
      );
      if (saved) onSaved(account.email, "");
    } else {
      const created = await run(() =>
        sendJson<{ temporary_password: string }>(
          "/api/admin/accounts",
          "POST",
          {
            email: email.trim(),
            display_name: displayName.trim(),
            role,
          },
        ),
      );
      if (created) onSaved(email.trim(), created.temporary_password);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? "Edit account" : "New account"}</DialogTitle>
          <DialogDescription>
            {account
              ? "Change this person's display name or role."
              : "A temporary password is generated for the new account."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`${id}-email`}>Email</Label>
            <Input
              id={`${id}-email`}
              type="email"
              required
              disabled={!!account}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-name`}>Display name</Label>
            <Input
              id={`${id}-name`}
              required
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-role`}>Role</Label>
            <select
              id={`${id}-role`}
              className={`${selectClass} w-full`}
              value={role}
              // You can't demote yourself; the backend refuses it too.
              disabled={isSelf}
              onChange={(e) => setRole(e.target.value as Role)}
            >
              <option value="responder">Responder</option>
              <option value="coordinator">Coordinator</option>
            </select>
          </div>
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {account ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateDialog({
  account,
  onClose,
  onDone,
}: {
  account: Account;
  onClose: () => void;
  onDone: () => void;
}) {
  const { pending, error, run } = useAction();

  async function confirm() {
    const done = await run(() =>
      sendJson(`/api/admin/accounts/${account.id}`, "PATCH", {
        is_active: false,
      }),
    );
    if (done) onDone();
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Deactivate {account.display_name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Deactivating signs them out and ends their shift right away. They
            won&apos;t be able to sign in until you reactivate the account.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(event) => {
              // Keep the dialog open so an error from the backend can be shown.
              event.preventDefault();
              void confirm();
            }}
          >
            Deactivate
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResetPasswordDialog({
  account,
  onClose,
  onDone,
}: {
  account: Account;
  onClose: () => void;
  onDone: (temporaryPassword: string) => void;
}) {
  const { pending, error, run } = useAction();

  async function confirm() {
    const result = await run(() =>
      sendJson<{ temporary_password: string }>(
        `/api/admin/accounts/${account.id}/reset-password`,
        "POST",
      ),
    );
    if (result) onDone(result.temporary_password);
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Reset password for {account.display_name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This signs them out and replaces their password with a new temporary
            one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            Reset password
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TemporaryPasswordDialog({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Share this with {email}. It won&apos;t be shown again, and they must
            change it the first time they sign in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code
            data-testid="temporary-password"
            className="flex-1 rounded-lg bg-muted px-2.5 py-1.5 font-mono break-all"
          >
            {password}
          </code>
          <Button variant="outline" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
