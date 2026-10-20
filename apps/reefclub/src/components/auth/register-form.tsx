"use client";

import { Alert, Button, FormField, Input } from "@acropora/ui";
import { useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import { PRIVACY_NOTICE_LINES, PRIVACY_NOTICE_VERSION } from "@/lib/consent";

/** The server's minimum (`ReefClubRegisterDto`): ten characters. */
export const PASSWORD_MIN = 10;

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

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
      await rc("POST", "/auth/register", {
        body: {
          email: email.trim(),
          password,
          consentVersion: PRIVACY_NOTICE_VERSION,
        },
      });
      setSent(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A regisztráció nem sikerült.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    // The same words whether the address is new or taken: the server never says which (plan 3.2).
    return (
      <Alert
        title="Nézd meg a postaládádat"
        description="Ha ehhez az e-mail címhez még nincs fiók, megerősítő levelet küldtünk. A levélben lévő linkkel tudod befejezni a regisztrációt."
      />
    );

  const ready =
    email.trim() !== "" &&
    password.length >= PASSWORD_MIN &&
    again === password &&
    accepted;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error ? (
        <Alert
          variant="danger"
          title="A regisztráció nem sikerült"
          description={error}
        />
      ) : null}
      <FormField label="E-mail cím" htmlFor="register-email">
        <Input
          id="register-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </FormField>
      <FormField
        label="Jelszó"
        htmlFor="register-password"
        description={`Legalább ${PASSWORD_MIN} karakter.`}
      >
        <Input
          id="register-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </FormField>
      <FormField
        label="Jelszó még egyszer"
        htmlFor="register-again"
        error={problem}
      >
        <Input
          id="register-again"
          type="password"
          autoComplete="new-password"
          required
          value={again}
          onChange={(event) => setAgain(event.target.value)}
        />
      </FormField>
      <details className="rounded-lg border border-line bg-pilot-grey-50 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">
          Az adatkezelési tájékoztató (tervezet)
        </summary>
        <p className="mt-2 font-medium text-amber-700">
          Ez még nem a végleges jogi szöveg: a tájékoztató jóváhagyásra vár.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-pilot-grey-700">
          {PRIVACY_NOTICE_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
        />
        <span>Elolvastam és elfogadom az adatkezelési tájékoztatót.</span>
      </label>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || !ready}
      >
        {busy ? "Regisztráció…" : "Regisztráció"}
      </Button>
    </form>
  );
}
