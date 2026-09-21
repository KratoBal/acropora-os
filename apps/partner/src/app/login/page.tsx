"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth";
import { CIMKE, LAP_CIM } from "@/components/frame";

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
    <main className="login-page">
      <form className="login-card" onSubmit={submit} noValidate>
        <p className={CIMKE}>ACROPORA SZERVIZ</p>
        <h1 className={LAP_CIM}>Partneri bejelentkezés</h1>
        <p className="mx-0 mt-0 mb-2 leading-[1.5] text-[#626273]">
          Adja meg a partneri szervizfiók céges e-mail címét és jelszavát.
        </p>
        <label>
          E-mail cím
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Jelszó
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={submitting}>
          {submitting ? "Bejelentkezés…" : "Bejelentkezés"}
        </button>
      </form>
    </main>
  );
}
