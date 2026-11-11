"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiFetch } from "@/lib/api";
import { type Me, meQueryKey, useMe } from "@/lib/portal/queries";

// Mirrors password_problems in backend/app/security/passwords.py, plus the route's reuse check.
const RULES = [
  "At least 12 characters (and at most 128)",
  "Not a commonly used password",
  "Doesn't contain your email address",
  "Different from your current password",
];

type Field = "current" | "new" | "confirm";
type Errors = Partial<Record<Field | "form", string>>;

function errorsFor(error: unknown): Errors {
  if (error instanceof ApiError && error.code === "wrong_password") {
    return { current: "Current password is incorrect." };
  }
  if (error instanceof ApiError && error.code === "weak_password") {
    return { new: error.detail };
  }
  if (error instanceof ApiError && error.status === 429) {
    return { form: "Too many attempts. Try again in a few minutes." };
  }
  return { form: "Something went wrong. Please try again." };
}

export function ChangePasswordForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (next !== confirm) {
      setErrors({ confirm: "Passwords don't match." });
      return;
    }
    setPending(true);
    setErrors({});
    try {
      await apiFetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      // Clear the flag locally, or the shell would send the user straight back here.
      queryClient.setQueryData<Me>(meQueryKey, (old) =>
        old ? { ...old, must_change_password: false } : old,
      );
      router.push("/portal");
    } catch (err) {
      setErrors(errorsFor(err));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {me?.must_change_password && (
        <p>
          Your account is using a temporary password. Choose a new one to
          continue.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium" id="password-rules">
          Your new password must be:
        </p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <PasswordField
          id="current-password"
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
          error={errors.current}
        />
        <PasswordField
          id="new-password"
          label="New password"
          autoComplete="new-password"
          value={next}
          onChange={setNext}
          error={errors.new}
          describedBy="password-rules"
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          error={errors.confirm}
        />
        {errors.form && (
          <p role="alert" className="text-sm text-destructive">
            {errors.form}
          </p>
        )}
        <Button type="submit" className="min-h-11" disabled={pending}>
          {pending ? "Changing password…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}

function PasswordField({
  id,
  label,
  autoComplete,
  value,
  onChange,
  error,
  describedBy,
}: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  describedBy?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          [describedBy, error && errorId].filter(Boolean).join(" ") || undefined
        }
      />
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
