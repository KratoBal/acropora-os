"use client";

import { Badge, Button, Card, FormField, Select } from "@acropora/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { DEVELOPMENT_USERS } from "@/lib/auth/development-auth";

export default function LoginPage() {
  const { isLoading, login, session } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState(DEVELOPMENT_USERS[0]?.email ?? "");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && session) router.replace("/");
  }, [isLoading, router, session]);

  async function handleLogin() {
    setSubmitting(true);
    setError(undefined);
    try {
      await login(email);
      router.replace("/");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A bejelentkezés sikertelen.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-teal-700 text-lg font-black text-white shadow-sm">
            A
          </span>
          <span className="text-xl font-bold tracking-tight text-slate-950">
            Acropora <span className="text-teal-700">OS</span>
          </span>
        </div>

        <Card className="p-6 sm:p-8">
          <div className="mb-6 text-center">
            <Badge variant="warning">Development mód</Badge>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-950">
              Bejelentkezés
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Válassz egy fejlesztési felhasználót. Jelszókezelés ebben a módban
              nincs.
            </p>
          </div>

          <FormField
            label="Fejlesztési felhasználó"
            htmlFor="development-user"
            error={error}
          >
            <Select
              id="development-user"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            >
              {DEVELOPMENT_USERS.map((user) => (
                <option key={user.email} value={user.email}>
                  {user.displayName} · {user.role}
                </option>
              ))}
            </Select>
          </FormField>

          <Button
            className="mt-5 w-full"
            size="lg"
            disabled={isLoading || submitting}
            onClick={() => void handleLogin()}
          >
            {submitting ? "Bejelentkezés…" : "Belépés development módban"}
          </Button>

          <p className="mt-5 rounded-lg bg-rose-50 px-3 py-2 text-center text-xs leading-5 text-rose-700">
            Ez a belépési mód production környezetben nem használható.
          </p>
        </Card>
      </div>
    </main>
  );
}
