"use client";

/**
 * Admin sign-in form — calls the EXISTING POST /api/auth/login endpoint
 * (scrypt verification, HMAC session cookie, rate limits, CSRF origin check
 * all happen server-side; this component only collects credentials and
 * surfaces the server's safe error messages).
 */

import { ArrowRight, LoaderCircle, LockKeyhole, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel, Input } from "@/components/ui/field";
import { loginStaff, ApiClientError } from "@/lib/client/admin";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await loginStaff(email.trim(), password);
      // Session cookie is set — enter the panel and refresh server state.
      router.replace("/admin");
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setError(caught.message);
        setFieldErrors(caught.fields ?? {});
      } else {
        setError("Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md">
      <div className="rounded-2xl border border-line bg-card p-7 shadow-soft sm:p-9">
        <div className="flex flex-col items-center text-center">
          <Logo href="/" />
          <h1 className="mt-6 text-xl font-semibold tracking-tight text-ink">
            Staff sign in
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            The Good Dentist — clinic administration
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-6 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <FieldLabel htmlFor="admin-email" required>
              Email address
            </FieldLabel>
            <Input
              id="admin-email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@clinic.example"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "admin-email-error" : undefined}
            />
            <div id="admin-email-error">
              <FieldError id="admin-email-error">{fieldErrors.email}</FieldError>
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="admin-password" required>
              Password
            </FieldLabel>
            <Input
              id="admin-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••••"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "admin-password-error" : undefined}
            />
            <div id="admin-password-error">
              <FieldError id="admin-password-error">{fieldErrors.password}</FieldError>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            size="md"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? (
              <>
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRight aria-hidden="true" className="size-4" />
              </>
            )}
          </Button>
        </form>
      </div>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <LockKeyhole aria-hidden="true" className="size-3.5" />
        Restricted to authorised clinic staff. Sessions expire after 7 days.
      </p>
    </div>
  );
}
