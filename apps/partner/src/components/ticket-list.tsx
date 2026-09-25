"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Icon,
  PilotBadge,
  PilotButton,
  PilotThemeRoot,
  partnerStatusBadgeVariant,
  serviceToneClass,
} from "@acropora/ui";

import { partnerApi } from "@/lib/api";
import { ticketScopeTotal } from "@/lib/ticket-scope-counts";
import { PANEL_CIM } from "./frame";

/**
 * A HIBAJEGY-LISTA -- FIGMA 9. KÖR (Partner Portál), a Make-terv
 * `PartnerPortalScreen.tsx:573-622` átültetése.
 *
 * VIZUÁLIS VÁLTÁS A KORÁBBI KÖRHÖZ KÉPEST: az előző kör a belső
 * `ServiceListHeader`/`ServiceListTabs`/`ServiceStatusBadge`/
 * `ServiceListFooter` (violet/`sv`) keretet vette át -- a mostani Figma-kör
 * a portál egészét a pilot-aqua design-rendszerre viszi (lásd a
 * `portal-shell.tsx`/`login/page.tsx` már beolvadt kör), ez a lap ugyanezt
 * követi: a fülek pill-stílusúak, teal háttérrel az aktívnál (573-586. sor),
 * zebra-csíkos táblázat (603. sor), színkódolt állapot-jelvény (609. sor).
 *
 * A `Message` ÉS AZ `Empty` KOMPONENS EBBŐL A FÁJLBÓL, VÁLTOZATLANUL MARAD.
 * Hat másik fájl importálja a `Message`-t, kettő az `Empty`-t -- egyiket sem
 * szabad átnevezni vagy máshova költöztetni. Ez a szerkesztés a `TicketList`
 * függvény belsejét cseréli: a hiba- és üres-állapot itt SAJÁT, pilot-stílusú
 * jelölést kap (a lap már nem a régi `sv`/`Message`/`Empty` vizuális
 * nyelvet beszéli), a lent exportált két függvény a másik hat hivóhelynek
 * változatlanul elérhető marad.
 *
 * A `-mx-5 -mt-10 -mb-16 max-w-none` OSZTÁLYOK INNEN ELKERÜLTEK (SÜRGŐS
 * JAVÍTÁS, 2026-09-25, Balázs éles hibajelentése): korábban a `globals.css`
 * `.content` dobozát (`margin: 0 auto; max-width: 1160px; padding: 2.5rem
 * 1.25rem 4rem;`) semlegesítették negatív margóval, hogy a fejléc-sáv és a
 * táblázat a Figma-terv szerint SZÉLÉIG érjen. Ez a technika HIBÁS volt: egy
 * GYERMEK negatív margója/`max-w-none`-ja nem tudja rávenni az ŐS saját
 * dobozát, hogy szélesebb legyen a SAJÁT `max-width`-jánál -- a tartalom
 * csak az ős (1160px-es, középre igazított) dobozáig ért, 1160px felett
 * világos rés maradt a képernyő szélén (pontosan ez volt a jelentett hiba).
 * A javítás a forrásnál történt: a `.content` osztály lekerült a közös
 * `portal-shell.tsx` `<main>`-jéről, és csak azok a lapok kérik ki
 * KÜLÖN-KÜLÖN, amik ma is igénylik (lásd `portal-shell.tsx` megjegyzését) --
 * ez a lap ezek után eleve a teljes rendelkezésre álló szélességet kapja, a
 * negatív margós semlegesítés feleslegessé (és HELYTELENNÉ) vált.
 *
 * KIHAGYVA EBBEN A KÖRBEN IS: a belső lista statisztika-csempéi. A Make-terv
 * SEM mutat csempét ezen a képernyőn (588-621. sor: csak fülek + tábla +
 * lábléc) -- ez egyezik a szándékos kihagyással, lásd lent a
 * `ticketScopeTotal` importjának indokát.
 */

const SCOPE_TABS: { key: "open" | "closed" | "all"; label: string }[] = [
  { key: "open", label: "Nyitott ügyek" },
  { key: "closed", label: "Lezárt ügyek" },
  { key: "all", label: "Összes ügy" },
];

const dateFormatter = new Intl.DateTimeFormat("hu-HU", { dateStyle: "medium" });

export function TicketList() {
  const [scope, setScope] = useState<"open" | "closed" | "all">("open");
  const [data, setData] = useState<Awaited<
    ReturnType<typeof partnerApi.tickets>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await partnerApi.tickets(scope));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "A hibajegyek nem tölthetők be.",
      );
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PilotThemeRoot className="flex min-h-screen flex-col bg-pilot-grey-50">
      <div className="flex items-center justify-between border-b border-pilot-grey-100 bg-white px-8 py-5">
        <div>
          <h1 className="text-xl font-semibold text-pilot-grey-900">
            Hibajegyek
          </h1>
          <p className="mt-0.5 text-sm text-pilot-grey-400">
            Tekintse át a saját cége hibajegyeit és azok aktuális állapotát.
          </p>
        </div>
        <Link href="/hibajegyek/uj">
          <PilotButton variant="primary">
            <Icon name="plus" size={14} />
            Új hibajegy nyitása
          </PilotButton>
        </Link>
      </div>

      {/*
        AZ INAKTIV FUL `bg-transparent`-JE NEM DISZ (SURGOS JAVITAS,
        2026-09-25, Balazs masodik hibajelentese ugyanerrol): a #1136
        `@layer base`-be tette a regi `button { background: #4c397f }`
        szabalyt, hogy a Tailwind `utilities` retege felulirhassa -- de ez
        csak akkor mukodik, ha VAN versengo `background-color`-t ado
        Tailwind-osztaly ugyanazon az elemen. Az inaktiv fulnek korabban
        CSAK `hover:bg-pilot-grey-50` allt, ami kizarolag `:hover`-en hat --
        NYUGALMI allapotban semmilyen osztaly nem adott `background-color`-t,
        tehat a `@layer base` szabaly maradt az EGYETLEN forras, es a lila
        tovabbra is atlatszott. Az aktiv ful ezert lett zold (sajat,
        felteten-nelkuli `bg-pilot-aqua-50`-je van), az inaktiv nem.
        Ellenorizve az eles CSS-en (2026-09-25 16:2x): a `@layer base`
        maga helyesen all, a hianyzo darab ez az egy sor volt.
      */}
      <div className="flex items-center gap-1 border-b border-pilot-grey-100 bg-white px-8 py-4">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setScope(tab.key)}
            className={`cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-all ${
              scope === tab.key
                ? "bg-pilot-aqua-50 text-pilot-aqua-700"
                : "bg-transparent text-pilot-grey-500 hover:bg-pilot-grey-50 hover:text-pilot-grey-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="px-8 py-4">
          <p
            className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {error}{" "}
            <button
              type="button"
              className="cursor-pointer font-medium underline"
              onClick={() => void load()}
            >
              Újrapróbálás
            </button>
          </p>
        </div>
      ) : null}

      {!data && !error ? (
        <p className="px-8 py-6 text-sm text-pilot-grey-400">
          Hibajegyek betöltése…
        </p>
      ) : null}

      {data?.items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pilot-aqua-50">
            <Icon name="service" size={24} className="text-pilot-aqua-600" />
          </div>
          <p className="text-base font-semibold text-pilot-grey-700">
            Nincs megjeleníthető hibajegy
          </p>
          <p className="max-w-xs text-sm text-pilot-grey-400">
            Ebben az állapotszűrőben jelenleg nincs saját hibajegye.
          </p>
        </div>
      ) : null}

      {data?.items.length ? (
        <div className="flex-1 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-pilot-grey-100">
                {["Hibajegy", "Helyszín", "Állapot", "Létrehozva"].map(
                  (col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap bg-white px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-pilot-grey-400"
                    >
                      {col}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.items.map((ticket, index) => (
                <tr
                  key={ticket.id}
                  className={`border-b border-pilot-grey-100 transition-colors hover:bg-pilot-aqua-50/40 ${
                    index % 2 === 0 ? "bg-white" : "bg-pilot-grey-50/50"
                  }`}
                >
                  <td className="px-5 py-3">
                    <Link
                      className="font-medium text-pilot-grey-900 hover:text-pilot-aqua-700"
                      href={`/hibajegyek/${ticket.id}`}
                    >
                      {ticket.title}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-pilot-grey-400">
                      {ticket.jobNumber}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-pilot-grey-500">
                    {ticket.departmentPath?.join(" / ") ??
                      "Helyszín nincs megadva"}
                  </td>
                  <td className="px-5 py-3">
                    <PilotBadge
                      variant={partnerStatusBadgeVariant(ticket.partnerStatus)}
                    >
                      {ticket.partnerStatusLabel}
                    </PilotBadge>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-pilot-grey-500">
                    <time dateTime={ticket.createdAt}>
                      {dateFormatter.format(new Date(ticket.createdAt))}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-pilot-grey-100 bg-white px-5 py-3 text-xs text-pilot-grey-400">
            {ticketScopeTotal(data.counts, scope)} hibajegy összesen
            {data.truncated
              ? " (a lista a megjelenített résznél hosszabb)"
              : ""}
          </div>
        </div>
      ) : null}
    </PilotThemeRoot>
  );
}

/**
 * AZ "info" TONUS EDDIG SZIN NELKUL JELENT MEG (murena merese, 2026-09-24).
 * A `.message.error` CSS-szabaly meg all a `globals.css`-ben, de `.message.info`
 * SOHA nem letezett -- a `tone="info"` hivohelye (`settings.tsx`, sikeres
 * jelszo-/alairokod-valtas utan) csak az alap `.message` keretet kapta,
 * szoveges kiemeles nelkul. Itt NEM uj CSS-szabalyt kap, hanem a mar meglevo,
 * megosztott `serviceToneClass.blue` Tailwind-tokent (`@acropora/ui`,
 * ugyanaz, amit a `Badge` "info" valtozata is hasznal) -- igy a szin egy
 * helyen valtoztathato a jovoben, nem egy ujabb, ide masolt hexaparral.
 */
const MESSAGE_TONE_CLASS: Record<"error" | "info", string> = {
  error: "error",
  info: serviceToneClass.blue,
};

export function Message({
  tone,
  text,
  retry,
}: {
  tone: "error" | "info";
  text: string;
  retry?: () => Promise<void>;
}) {
  return (
    <div
      className={`message ${MESSAGE_TONE_CLASS[tone]}`}
      role={tone === "error" ? "alert" : undefined}
    >
      <span>{text}</span>
      {retry ? (
        <button type="button" onClick={() => void retry()}>
          Újrapróbálás
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <h2 className={PANEL_CIM}>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
