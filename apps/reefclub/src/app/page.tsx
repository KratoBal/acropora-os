"use client";

import { Button } from "@acropora/ui";
import Link from "next/link";

import { useSession } from "@/lib/session";

/**
 * The start page. Signed out: the two ways in. Signed in: who is signed in and
 * the way out; the aquarium pages follow in the next PRs of task
 * reefclub-szelet-9.
 */
export default function ReefClubHome() {
  const { state, signOut } = useSession();

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">ReefClub</h1>
      <p className="mt-3 text-sm text-pilot-grey-600">
        Teszt környezet. A felület építés alatt van.
      </p>
      {state.status === "loading" ? (
        <p role="status" className="mt-6 text-sm text-pilot-grey-500">
          Betöltés…
        </p>
      ) : null}
      {state.status === "anonymous" ? (
        <div className="mt-6 flex gap-3">
          <Link
            href="/belepes"
            className="font-semibold text-pilot-aqua-700 underline"
          >
            Belépés
          </Link>
          <Link
            href="/regisztracio"
            className="font-semibold text-pilot-aqua-700 underline"
          >
            Regisztráció
          </Link>
        </div>
      ) : null}
      {state.status === "unavailable" ? (
        <p role="alert" className="mt-6 text-sm text-rose-700">
          {state.message}
        </p>
      ) : null}
      {state.status === "user" ? (
        <div className="mt-6 space-y-3">
          <p className="text-sm">
            Belépve: <strong>{state.me.email}</strong>
          </p>
          <Button variant="secondary" onClick={() => void signOut()}>
            Kilépés
          </Button>
        </div>
      ) : null}
    </main>
  );
}
