"use client";

import { Alert, Button, FormField, Input } from "@acropora/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import { useSession } from "@/lib/session";

export function LoginForm() {
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rc("POST", "/auth/login", {
        body: { email: email.trim(), password },
      });
      await refresh();
      router.replace("/");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A belépés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert
          variant="danger"
          title="A belépés nem sikerült"
          description={error}
        />
      ) : null}
      <FormField label="E-mail cím" htmlFor="login-email">
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <FormField label="Jelszó" htmlFor="login-password">
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || !email || !password}
      >
        {busy ? "Belépés…" : "Belépés"}
      </Button>
    </form>
  );
}
