"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/hibajegyek");
  }, [loading, router, user]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.replace("/hibajegyek");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A bejelentkezés nem sikerült.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-pilot-grey-50 px-5">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-pilot-aqua-600">
            <span className="text-lg font-bold text-white">A</span>
          </div>
          {/*
            "ACROPORA SZERVIZ" MARAD (acrobot dontese fugg tole, meg nem
            erkezett meg): a Figma-terv itt csak "ACROPORA"-t mutat, mert a
            terv 13. sora ("today the top bar says 'Acropora Szerviz'... the
            grouped menu below is a proposal") szerint ez szandekos valtas
            lenne -- amig nincs megerositve, a mai szoveg marad.
          */}
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-pilot-grey-400">
            ACROPORA SZERVIZ
          </p>
          <h1 className="text-2xl font-semibold text-pilot-grey-900">
            Partneri bejelentkezés
          </h1>
          <p className="mx-auto mt-2 max-w-[22rem] text-sm leading-[1.5] text-pilot-grey-500">
            Adja meg a partneri szervizfiók céges e-mail címét és jelszavát.
          </p>
        </div>

        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-pilot-red-50 px-4 py-3 text-sm text-pilot-red-700 ring-1 ring-pilot-red-100"
          >
            {error}
          </div>
        ) : null}

        <form
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-4 rounded-2xl border border-pilot-grey-200 bg-white px-6 py-6"
        >
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-pilot-grey-700">
              E-mail cím
            </span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-lg border border-pilot-grey-300 px-3 py-2.5 text-pilot-grey-900"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-pilot-grey-700">
              Jelszó
            </span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-lg border border-pilot-grey-300 px-3 py-2.5 text-pilot-grey-900"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-pilot-aqua-600 px-4 py-2.5 font-bold text-white disabled:cursor-wait disabled:opacity-65"
          >
            {submitting ? "Bejelentkezés…" : "Bejelentkezés"}
          </button>
        </form>

        {/*
          UJ MONDAT A KARTYA ALATT, A TERV SZERINT (PartnerPortalScreen.tsx:553-555).
          A CIM ALATTI MONDAT IS MARAD: a build brief ket kulon dontendo
          kerdeskent kezelte oket, es amig nincs valasz, egyik sem torlodik.
        */}
        <p className="mt-4 text-center text-xs text-pilot-grey-400">
          Hozzáférési problémánál lépjen kapcsolatba az Acropora
          ügyfélszolgálatával.
        </p>
      </div>
    </main>
  );
}
