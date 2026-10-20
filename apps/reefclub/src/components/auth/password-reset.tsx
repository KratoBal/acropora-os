"use client";

import { Alert, Button, FormField, Input } from "@acropora/ui";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import { tokenFromHash } from "@/lib/hash-token";

import { PASSWORD_MIN } from "./register-form";

/**
 * Two steps on one page, as the e-mails link it: `/jelszo-visszaallitas`
 * asks for the e-mail address; `/jelszo-visszaallitas#token=…` sets the new
 * password. The request answers the same whether the address has an account
 * or not (plan 3.2).
 */
export function PasswordReset() {
  const [token, setToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const found = tokenFromHash(window.location.hash);
    if (found) window.history.replaceState(null, "", window.location.pathname);
    setToken(found);
  }, []);

  if (token === undefined) return null;
  return token ? <NewPassword token={token} /> : <RequestReset />;
}

function RequestReset() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rc("POST", "/auth/password-reset", {
        body: { email: email.trim() },
      });
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A kérés nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <Alert
        title="Nézd meg a postaládádat"
        description="Ha ehhez az e-mail címhez tartozik fiók, küldtünk egy levelet az új jelszó beállításához."
      />
    );
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert
          variant="danger"
          title="A kérés nem sikerült"
          description={error}
        />
      ) : null}
      <FormField label="E-mail cím" htmlFor="reset-email">
        <Input
          id="reset-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || !email.trim()}
      >
        {busy ? "Küldés…" : "Új jelszó kérése"}
      </Button>
    </form>
  );
}

function NewPassword({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const problem =
    password.length > 0 && password.length < PASSWORD_MIN
      ? `A jelszó legalább ${PASSWORD_MIN} karakter legyen.`
      : again.length > 0 && again !== password
        ? "A két jelszó nem egyezik."
        : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rc("POST", "/auth/password-reset/confirm", {
        body: { token, password },
      });
      setDone(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Az új jelszót nem sikerült beállítani.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <div className="space-y-4">
        <Alert
          title="Az új jelszó beállítva"
          description="Minden korábbi munkamenet kilépett. Lépj be az új jelszóval."
        />
        <Link
          href="/belepes"
          className="font-semibold text-pilot-aqua-700 underline"
        >
          Tovább a belépéshez
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      <FormField
        label="Új jelszó"
        htmlFor="new-password"
        description={`Legalább ${PASSWORD_MIN} karakter.`}
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      <FormField
        label="Új jelszó még egyszer"
        htmlFor="new-password-again"
        error={problem}
      >
        <Input
          id="new-password-again"
          type="password"
          autoComplete="new-password"
          required
          value={again}
          onChange={(event) => setAgain(event.target.value)}
        />
      </FormField>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || password.length < PASSWORD_MIN || again !== password}
      >
        {busy ? "Mentés…" : "Új jelszó beállítása"}
      </Button>
    </form>
  );
}
