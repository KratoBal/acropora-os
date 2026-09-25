"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { useThemePreference } from "@acropora/ui";

import { hasNavigationEntry, useAuth } from "./auth";
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

/**
 * AZ "AKVARISZTIKA" CSOPORT -- Balazs dontese, 2026-09-25 (Partner Portal
 * Akvariumok terv, emlek 1839): a lista/adatlap/uj meres/uj akvarium
 * sorozat elso resze. Csak a LISTA all itt ma; az adatlap
 * (`/akvariumok/[id]`) es az uj akvarium urlap kulon korben johet.
 *
 * A "Kalkulatorok" tetel 2026-09-25-tol bovult ide (Balazs jovahagyasa),
 * SAJAT `entryId`-vel -- ld. `packages/types/src/navigation.ts` "calculators"
 * bejegyzesenek fejleceet arrol, miert nem osztja meg az "aquariums"
 * azonositot, holott ma ugyanazt a jogot hasznaljak.
 */
const AKVARISZTIKA_MENU = [
  { href: "/akvariumok", label: "Akváriumok", entryId: "aquariums" },
  { href: "/kalkulatorok", label: "Kalkulátorok", entryId: "calculators" },
];

/**
 * A `packages/types/src/navigation.ts` "aquariums" bejegyzésének
 * azonosítója -- ugyanaz a string, amit a szerver `/auth/me`-je
 * `user.navigation`-ben visszaad, ha a hívó szerepe rendelkezik az
 * `AQUARIUMS_VIEW` joggal.
 */
const AQUARIUMS_NAV_ENTRY_ID = "aquariums";

/** Ugyanaz a minta, a "calculators" bejegyzésre. */
const CALCULATORS_NAV_ENTRY_ID = "calculators";

const BEALLITASOK_HREF = "/beallitasok";
const AKVARIUMOK_HREF = "/akvariumok";
const KALKULATOROK_HREF = "/kalkulatorok";

export function PortalShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const { effectiveTheme } = useThemePreference();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, router, user]);

  const canViewAquariums = hasNavigationEntry(user, AQUARIUMS_NAV_ENTRY_ID);
  const onAquariumsRoute = pathname.startsWith(AKVARIUMOK_HREF);

  const canViewCalculators = hasNavigationEntry(user, CALCULATORS_NAV_ENTRY_ID);
  const onCalculatorsRoute = pathname.startsWith(KALKULATOROK_HREF);

  /*
    UTVONAL-VEDELEM, NE CSAK MENUPONT-REJTES. A menupont eltuntetese
    onmagaban nem allitja meg a kozvetlen URL-beirast -- egy regi API
    (amig a #1116 nincs elesitve) mellett ide navigalva a lista/adatlap
    komponens egy nem letezo vegpontot hivna. A `canViewAquariums` UGYANAZT
    a szerver-valaszt nezi, amit a menu is, tehat a ket hely nem tud
    szetcsuszni (acrobot kerese, msg_id 23542, 2026-09-25).
  */
  useEffect(() => {
    if (!loading && user && !canViewAquariums && onAquariumsRoute) {
      router.replace("/hibajegyek");
    }
  }, [loading, user, canViewAquariums, onAquariumsRoute, router]);

  /** Ugyanaz a minta, a Kalkulátorok útvonalára. */
  useEffect(() => {
    if (!loading && user && !canViewCalculators && onCalculatorsRoute) {
      router.replace("/hibajegyek");
    }
  }, [loading, user, canViewCalculators, onCalculatorsRoute, router]);

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
  if (!canViewAquariums && onAquariumsRoute) {
    return <main className="centered">Átirányítás…</main>;
  }
  if (!canViewCalculators && onCalculatorsRoute) {
    return <main className="centered">Átirányítás…</main>;
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
      {/*
        DATA-THEME ITT, ES CSAK ITT (SURGOS JAVITAS, 2026-09-25, Balazs elo
        hibajelentese, ticket.acropora.hu): korabban a `data-theme`-et
        KIZAROLAG az egyes pilot oldalak sajat `PilotThemeRoot` gyokere
        adta (lasd `pilot-ui.tsx` fejleceit) -- az oldalsav SOSEM kapta meg,
        tehat sotet modban az oldalsav vilagos maradt a sotet tartalom
        mellett. Az oldalsav `bg-white`/`text-pilot-grey-*`/`bg-pilot-aqua-*`
        osztalyai MAR token-vezereltek, es a `figma-theme.css` mar tartalmazza
        a sotet parjukat (`[data-theme="dark"] .bg-white` es a
        `--color-pilot-*` ujradefinialas) -- tehat ez a sor semmi UJ CSS-t
        nem igenyel, csak az ATTRIBUTUMOT rakja fel.
        SZANDEKOSAN NEM a `<main>`-re vagy a korulotte allo `<div>`-re kerul:
        a `{children}` alatt MEG all KET lap, amelyik nativ `input`/`select`
        elemet hasznal sajat, nyers CSS szinekkel: az Akvariumok lista
        (sajat kereso mezeje, `aquarium-list.tsx`) es az Akvariumok adatlap
        (a beagyazott `AquariumWaterValues` meresszamlalo mezoi,
        `aquarium-water-values.tsx`). Az Uj akvarium, az "Uj hibajegy" es a
        "Beallitasok" MAR `PilotInput`/`PilotSelect`-et hasznal (lasd
        `new-aquarium.tsx`, `new-ticket.tsx`, `settings.tsx`), tehat oket ez
        a korlat nem erinti. A `[data-theme="dark"]
        input/select/textarea { ... !important }` szabaly a maradek ket
        lapot FUGGETLENUL a sajat osztalyuktol sotetitene, mikozben a
        korulottuk allo panel vilagos maradna: ugyanaz a "kevert" hiba,
        amit ez a javitas felszamol, csak MASIK ket lapon. A hatokor tehat
        szandekosan az oldalsavra szukul.
      */}
      <aside
        data-theme={effectiveTheme}
        className="fixed inset-y-0 left-0 z-30 hidden w-52 flex-col border-r border-pilot-grey-200 bg-white lg:flex"
      >
        <div className="border-b border-pilot-grey-100 px-5 py-4">
          <Link
            href="/hibajegyek"
            className="flex items-center gap-2 no-underline"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-pilot-aqua-600 text-xs font-bold text-white">
              A
            </span>
            {/*
              "ACROPORA" + KULON ALCIM "PARTNER PORTAL" (acrobot dontese,
              2026-09-25): a "Szerviz" szo mar szuk a markara, mert a portal
              tobbre keszul a szerviznel (Akvarisztika resz, meg epul).
            */}
            <span className="min-w-0">
              <span className="block truncate text-xs font-bold leading-none text-pilot-grey-900">
                Acropora
              </span>
              <span className="mt-0.5 block truncate text-[10px] leading-tight text-pilot-grey-400">
                Partner portál
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
            AZ "AKVARISZTIKA" CSOPORT CSAK A SZERVER JELZESERE LATSZIK.

            EZ A KOMMENT KORABBAN AZT ALLITOTTA, HOGY NINCS SZUKSEG KULON
            ELLENORZESRE, MERT AZ AQUARIUMS_VIEW MINDEN PARTNER_SERVICE
            FIOKE (szerep-szintu jog) -- EZ IGAZ, DE NEM ELEG. Az
            `apps/partner` MINDEN beolvasztaskor AZONNAL elesre telepul
            (ticket.acropora.hu), az `apps/api` viszont csak Balazs kulon
            engedelyevel. Ha ez a menupont a frontend sajat, beegetett
            jog-tablajara tamaszkodna (`hasPermission()`), egy regi API
            mellett is latszana, es az allatkert egy hibazo menupontot
            kapna. A `canViewAquariums` ezert a `/auth/me` VALASZANAK
            `navigation` mezojet nezi -- azt, amit az ELESBEN FUTO API
            tenylegesen ismer (lasd `./auth.tsx` `hasNavigationEntry`
            fejleckommentjet). Ellenorizve 2026-09-25: a #1116 (a
            AQUARIUMS_VIEW-t a PARTNER_SERVICE-re adja) meg nincs
            beolvasztva, es ez a blokk emiatt ma helyesen REJTVE marad,
            mert a live `/auth/me` navigation tombje meg nem tartalmazza
            az "aquariums" bejegyzest.

            A "Kalkulatorok" tetel UGYANEZT a mintat koveti, sajat
            "calculators" bejegyzessel (`canViewCalculators`) -- ma
            ugyanazt az AQUARIUMS_VIEW jogot nezi, mint az akvariumok,
            de a ketto KULON van merve, tehat a jovoben szet is
            valhatnak anelkul, hogy barmelyik masikat modositani kellene.
            A csoport-fejlec akkor latszik, ha a KET tetel BARMELYIKE
            lathato -- egy tetel per-tetel szures dontheti el, melyik sor
            jelenik meg alatta.
          */}
          {(canViewAquariums || canViewCalculators) && (
            <div>
              <p className="mb-1 px-3 text-[9px] font-bold uppercase tracking-widest text-pilot-grey-400">
                Akvarisztika
              </p>
              <div className="flex flex-col gap-0.5">
                {AKVARISZTIKA_MENU.filter((item) =>
                  hasNavigationEntry(user, item.entryId),
                ).map((item) => {
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
          )}
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

      {/*
        A `.content` (max-szelesseg + kozepre-igazitas doboz) INNEN ELKERULT
        (SURGOS JAVITAS, 2026-09-25, Balazs elo hibajelentese): korabban a
        pilot-aqua oldalak `-mx-5 -mt-10 -mb-16 max-w-none` negativ margoval
        probaltak kilepni ebbol a dobozbol, hogy teljes szelessegben
        toltsenek ki -- ez HIBAS technika volt, mert egy GYERMEK negativ
        margoja/`max-w-none`-ja nem tudja felulirni az OS sajat `max-width:
        1160px; margin: 0 auto`-jat: a tartalom csak az os dobozaig ert, es
        1160px felett vilagos res maradt a szelen (pontosan Balazs jelentett
        tunete). A javitas a FORRASNAL tortent: a `.content` doboz lekerult
        errol a kozos hejrol, a pilot oldalak negativ margos semlegesitese
        pedig okafogyotta valt es szinten torolve lett (lasd azok sajat
        `PilotThemeRoot` hivasat). A `.content` osztaly MOST MAR EGYETLEN
        lapon SEM all: mind a tizenegy portal-lap pilot-aqua, az utolso
        harom (Akvariumok lista, Akvariumok adatlap, Uj akvarium) 2026-09-25-
        tol (murena, #1145), a "Beallitasok" ugyanaznap, ezzel a javitassal
        -- lasd azok sajat `PilotThemeRoot` gyoker elemet.
      */}
      {/*
        MASODIK KOR, 2026-09-25 (Balazs 16:50-es kepei): a `<main>`-nek
        eddig NEM volt sajat hattere, tehat az ALATTA allo, data-theme
        nelkuli oldalsav-nelkuli SHELL (a legkulso `<div>` fent,
        `bg-pilot-grey-50`, mindig VILAGOS) latszott at ott, ahol egy
        RESZLETLAP sajat `PilotThemeRoot`-ja NEM visel `min-h-screen`-t
        (`ticket-detail.tsx`, `asset-detail.tsx`, `worksheet-detail.tsx`,
        `aquarium-detail.tsx`, `new-aquarium.tsx` -- mind csak `px-8 py-6`
        vagy semmi magassagot nem kenyszerit). Rovid tartalomnal a sotet
        doboz alatt ezert vilagos csik maradt.

        A JAVITAS ITT KOZPONTI, NEM MIND AZ OT RESZLETLAPON KULON-KULON:
        a `<main>` maga kapja meg a `data-theme`-et es a `min-h-screen
        bg-pilot-grey-50`-t, ugyanazt a mintat, mint az `<aside>`. EZ NEM
        UJ KOCKAZAT a nativ `input`/`select` sotetito szabalynak (lasd
        fent az oldalsav-korlatozas indoklasat): minden portal-lap MAR
        MOST is a SAJAT `PilotThemeRoot` gyokeren visel `data-theme`-et
        (mind a 11 lap, lasd `portal-shell-theme.spec.ts` `pilotLapok`
        listajat), tehat az Akvariumok lista sajat keresoje es az
        Akvariumok adatlap `AquariumWaterValues` mezoi MA IS a SAJAT
        lapjuk data-theme-e alatt allnak -- a `<main>` sajat attributuma
        csak azt a RESET tolti ki, ami egy rovid lap ALATT marad, nem
        valtoztat semmit a lapok SAJAT tartalman.
      */}
      <div className="lg:pl-52">
        <main
          data-theme={effectiveTheme}
          className="min-h-screen bg-pilot-grey-50"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
