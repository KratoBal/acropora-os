"use client";

import { Alert, Button, FormField, Input } from "@acropora/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { rc } from "@/lib/api";
import { useSession } from "@/lib/session";

const METHOD_LABEL = {
  PASSWORD: "jelszó",
  GOOGLE: "Google",
  APPLE: "Apple",
} as const;

/**
 * The account: how the user signs in, the release e-mail switch, and the
 * deletion. DELETE /me needs a FRESH sign-in with one of the account's own
 * methods; this app can do the password one. An account that has only Google
 * or Apple says so instead of showing a form that cannot work.
 */
export function Account() {
  const { state } = useSession();
  if (state.status !== "user") return null;
  return (
    <div className="max-w-lg space-y-8">
      <h1 className="text-2xl font-semibold">Fiók</h1>
      <Details />
      <Notifications />
      <Deletion />
    </div>
  );
}

function Details() {
  const { state } = useSession();
  if (state.status !== "user") return null;
  const { me } = state;
  return (
    <section className="space-y-1 text-sm">
      <p>
        <span className="text-pilot-grey-600">E-mail cím:</span>{" "}
        <strong>{me.email}</strong>
      </p>
      <p>
        <span className="text-pilot-grey-600">Belépés:</span>{" "}
        {me.loginMethods
          .map((m) => METHOD_LABEL[m as keyof typeof METHOD_LABEL] ?? m)
          .join(", ")}
      </p>
    </section>
  );
}

function Notifications() {
  const { state, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.status !== "user") return null;

  async function change(notifyOnRelease: boolean) {
    setBusy(true);
    setError(null);
    try {
      await rc("PATCH", "/me", { body: { notifyOnRelease } });
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A beállítás nem mentődött.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Értesítés</h2>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={state.me.notifyOnRelease}
          disabled={busy}
          onChange={(event) => void change(event.target.checked)}
        />
        <span>
          E-mailt kérek, amikor a bolt véglegesít egy mérést. A levélben nincs
          mérési érték, csak egy link ide.
        </span>
      </label>
    </section>
  );
}

function Deletion() {
  const router = useRouter();
  const { state, refresh } = useSession();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (state.status !== "user") return null;
  const canWithPassword = state.me.loginMethods.includes("PASSWORD");

  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rc("DELETE", "/me", { body: { method: "PASSWORD", password } });
      // the server cleared the cookies; reading the session again makes it anonymous
      await refresh();
      router.replace("/belepes");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "A fiók törlése nem sikerült.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-rose-200 p-5">
      <h2 className="text-lg font-semibold">Fiók törlése</h2>
      <p className="text-sm text-pilot-grey-600">
        A törlés kérése után a fiókod azonnal zárolva van, és 30 nap múlva
        törlődik minden adata. A saját akváriumaid és méréseid is. A bolti
        nyilvántartás megmarad.
      </p>
      {error ? (
        <Alert variant="danger" title="Nem sikerült" description={error} />
      ) : null}
      {!canWithPassword ? (
        <p className="text-sm text-pilot-grey-600">
          Ez a fiók külső belépéssel (Google vagy Apple) jött létre, a törlés
          friss külső belépést kér, ami ebben a változatban még nincs meg. Írj a
          boltnak, és segítenek.
        </p>
      ) : asking ? (
        <form onSubmit={remove} className="space-y-3" noValidate>
          <FormField
            label="A jelszavad a megerősítéshez"
            htmlFor="delete-password"
          >
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FormField>
          <div className="flex gap-3">
            <Button type="submit" variant="danger" disabled={busy || !password}>
              {busy ? "Törlés…" : "Igen, kérem a fiókom törlését"}
            </Button>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Mégse
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="danger" onClick={() => setAsking(true)}>
          Fiók törlése
        </Button>
      )}
    </section>
  );
}
