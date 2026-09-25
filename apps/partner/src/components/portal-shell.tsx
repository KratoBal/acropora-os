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
/**
 * A "MUSZAKI" CSOPORT, CSAK A MA VALODI, ELES ADATTAL MUKODO HAROM TETELLEL.
 *
 * A Figma 9. koros terv (`PartnerPortalScreen.tsx:397-403`) ide meg ket
 * tovabbi tetelt tesz ("Megrendelesek", "Teljesitesi igazolasok", mindkettot
 * `isNew` jelzessel) -- ezek MA sehol nem leteznek a portal kodjaban
 * (barracuda leltara, "AMI A PORTALON MA NINCS" szakasz), es adatmodellt,
 * jogosultsagot igenyelnek, amirol Balazs meg nem dontott. NE kerulnenek be
 * ide, sem funkcioval, sem helykitolto "Uj" jelvennyel.
 */
const MUSZAKI_MENU = [
  { href: "/hibajegyek", label: "Hibajegyek" },
  { href: "/munkalapok", label: "Munkalapok" },
  { href: "/eszkozok", label: "Eszközök" },
];

const BEALLITASOK_HREF = "/beallitasok";

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

  const beallitasokActive = pathname.startsWith(BEALLITASOK_HREF);

  return (
    <div className="min-h-screen bg-pilot-grey-50">
      {/*
        BAL OLDALI, ROGZITETT OLDALSAV a felso savas menu helyett (acrobot
        dontese, Figma 9. kor build brief, "SHELL ES NAVIGACIO" szakasz).
        Szelesseg es szinek a `PartnerPortalScreen.tsx:439` prototipus szerint
        (`w-52`, `pilot-aqua-*`/`pilot-grey-*` token, NEM a portal regi,
        lila `theme.css` `brand-*` skalaja).
      */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-52 flex-col border-r border-pilot-grey-200 bg-white lg:flex">
        <div className="border-b border-pilot-grey-100 px-5 py-4">
          <Link
            href="/hibajegyek"
            className="flex items-center gap-2 no-underline"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pilot-aqua-600 text-xs font-bold text-white">
              A
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold leading-none text-pilot-grey-900">
                Acropora <span className="font-medium">Szerviz</span>
              </span>
            </span>
          </Link>
        </div>

        <nav
          aria-label="Partneri menü"
          className="flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-3"
        >
          <div>
            <p className="mb-1 px-3 text-[9px] font-bold uppercase tracking-widest text-pilot-grey-400">
              Műszaki
            </p>
            <div className="flex flex-col gap-0.5">
              {MUSZAKI_MENU.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-9 w-full items-center rounded-lg px-3 text-sm font-medium no-underline transition-colors ${
                      active
                        ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                        : "text-pilot-grey-500 hover:bg-pilot-grey-50 hover:text-pilot-grey-800"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
          {/*
            AZ "AKVARISZTIKA" CSOPORT MA SENKINEK NEM LATSZIK, SZANDEKOSAN
            (build brief, "A KET MENUCSOPORT ELOKESZITESE" szakasz, 3. pont):
            ez a jogkor ma nem letezik a kodban, tehat a helyes alapallapot a
            REJTVE, nem a latszik. Ha egyszer a partner-akvarisztika kepesseg
            elkeszul, ide egy masodik, ugyanilyen felepitesu blokk kerul,
            felteve a jogosult felhasznaloknak.
          */}
        </nav>

        <div className="px-2 pb-2">
          <Link
            href={BEALLITASOK_HREF}
            aria-current={beallitasokActive ? "page" : undefined}
            className={`flex h-9 w-full items-center rounded-lg px-3 text-sm font-medium no-underline transition-colors ${
              beallitasokActive
                ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                : "text-pilot-grey-500 hover:bg-pilot-grey-50 hover:text-pilot-grey-800"
            }`}
          >
            Beállítások
          </Link>
        </div>

        <div className="border-t border-pilot-grey-100 px-4 py-4">
          <p className="mb-2 truncate text-xs font-medium text-pilot-grey-800">
            {user.displayName}
          </p>
          <button
            type="button"
            className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-normal text-pilot-grey-400 transition-colors hover:text-pilot-grey-700"
            onClick={() => void logout().then(() => router.replace("/login"))}
          >
            Kijelentkezés
          </button>
        </div>
      </aside>

      <div className="lg:pl-52">
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
