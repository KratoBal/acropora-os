"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useAuth } from "./auth";
import { LAP_CIM } from "./frame";

/*
  A HELYSZINEK MENUPONT 2026-09-23-IG ITT ALLT. Balazs kerte a kivetelet
  (2026-09-22 11:53:49 UTC, "a partnernek nem relevans a helyszin, ugyhogy
  azt a menut... szedjuk ki hogy ne lassa") -- a jegynyitas helyszin-
  valasztoja MARAD (`new-ticket.tsx`), csak a sajat, kulon oldala tunt el.
*/
const navigation = [
  { href: "/hibajegyek", label: "Hibajegyek" },
  { href: "/munkalapok", label: "Munkalapok" },
  { href: "/eszkozok", label: "Eszközök" },
  { href: "/beallitasok", label: "Beállítások" },
];

export function PortalShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  if (loading) return <main className="centered">Munkamenet ellenőrzése…</main>;
  if (!user) {
    return <main className="centered">Átirányítás a bejelentkezéshez…</main>;
  }
  if (user.role !== "PARTNER_SERVICE" || !user.customerId) {
    return (
      <main className="access-denied">
        <h1 className={LAP_CIM}>Ez a portál partneri fiókhoz készült</h1>
        <p>
          Kérjük, a partneri szervizfiók céges e-mail címével jelentkezzen be.
        </p>
        <button
          type="button"
          onClick={() => void logout().then(() => router.replace("/login"))}
        >
          Kijelentkezés
        </button>
      </main>
    );
  }

  return (
    <div className="portal">
      <header className="topbar">
        <Link className="brand" href="/hibajegyek">
          Acropora <span>Szerviz</span>
        </Link>
        <div className="account">
          <span>{user.displayName}</span>
          <button
            type="button"
            onClick={() => void logout().then(() => router.replace("/login"))}
          >
            Kijelentkezés
          </button>
        </div>
      </header>
      <nav className="navigation" aria-label="Partneri menü">
        {navigation.map((item) => (
          <Link
            key={item.href}
            className={pathname.startsWith(item.href) ? "active" : ""}
            href={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}
