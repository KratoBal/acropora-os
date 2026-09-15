"use client";

import { useEffect, useState } from "react";

import { ServiceIcon } from "./service-list-chrome";

/**
 * "NINCS INTERNET" SAV AZ IRODAI LAPOK TETEJEN.
 *
 * A prototipus (exchange/service-redesign-2026-09) HAROM allitast tesz ebben a
 * savban, es NALUNK EBBOL EGY all meg. A sav nem mondhat olyat, ami mogott
 * nincs mechanizmus -- egy hazudos sav rosszabb a hianyzonal, mert epp akkor
 * olvassak, amikor a felhasznalo bizonytalan.
 *
 *   "Nincs internet. A mentett adatokat latod."   ->  MEGALL, ez a savunk
 *   "N modositas feltoltesre var" (+ Szinkronizalas lapra mutato hivatkozas)
 *                                                 ->  NEM ALL MEG (lasd lent)
 *   "Utolso frissites: 09:32"                     ->  NEM ALL MEG (lasd lent)
 *
 * A MASODIK: a mondat egy HELYI SORT feltetelez. A mobilnak van ilyen
 * (`sync_queue`, apps/mobile/src/lib/offline/), a webnek NINCS: a bongeszo-
 * oldali tarolas mind a 17 helye a fejlesztoi munkamenet, nem muvelet-sor, es
 * service worker sincs. Ezert a webes lapon ez a mondat nem "kevesbe hasznos",
 * hanem HAMIS -- es a hivatkozasa egy ures lapra vinne.
 *
 * A HARMADIK, ES EZT A MASODIK MIATT ERDEMES ESZREVENNI: a "09:32" ugyanabba a
 * csaladba tartozik. Ma nem adjuk at a lapnak, mikor toltodott be az adat,
 * tehat egy ideot kiirni itt talalgatas lenne. Ez viszont OLCSON megszerezheto
 * (a lap tudja, mikor rajzolodott), ezert nem elvi akadaly, hanem hianyzo
 * bemenet -- ha bekerul, ez a sav bovitheto vele.
 *
 * A DETEKTALAS HATARA, KIMONDVA: a `navigator.onLine` megbizhatoan mond
 * HAMISAT, amikor a bongeszo tudja, hogy nincs kapcsolat; IGAZAT viszont
 * mondhat akkor is, ha a halozat valojaban nem visz sehova (bejelentkezteto
 * portal, halott alagut). Mi CSAK a hamisra rajzolunk savot, tehat a tevedes
 * iranya az, hogy neha ELMARAD a sav -- nem az, hogy tevesen allit valamit.
 * A ket hiba ara nem egyforma: egy elmaradt sav mellett a felhasznalo a sajat
 * szemevel latja, hogy nem tortenik semmi; egy hamis sav mellett elhiszi.
 */
/**
 * A LAP HAROM KULONBOZO DOLGOT MUTATHAT, ES A SAVNAK MIND A HAROMRA IGAZAT
 * KELL MONDANIA -- EZERT KOTELEZO, ES EZERT NEM ELHAGYHATO.
 *
 * Az elso valtozat egyetlen mondatot mondott: "a legutobb betoltott adatokat
 * latod". Nautilus merte vissza, hogy HIDEG betoltesnel ez HAMIS: ha meg semmi
 * nem toltodott be, a lap URES, es a sav azt allitja, hogy a regi adatokat
 * nezed. Ez pontosan az a hiba, ami ellen a sav keszult.
 *
 * ES TAGABB, MINT AMIT O LATOTT: a ket URLAP-lapon a mondat MINDIG hamis volt,
 * kapcsolattal is -- ott nincs "betoltott adat", ott egy urlap all, es a tet
 * nem a frissites, hanem a MENTES.
 *
 * A prop KOTELEZO, es ez szandekos. Egy elhagyhato jelzes alapertelmezett
 * ertekkel azt jelentene, hogy aki elfelejti atadni, CSENDBEN a rossz mondatot
 * kapja -- vagyis ugyanaz a hiba allna elo ujra, csak nehezebben eszrevehetoen.
 * Igy a fordito kerdezi meg minden laptol, amit a sav allit rola.
 *
 * ES A HATARA, MERT KULONBEN TOBBET IGER, MINT AMIT AD: a fordito azt
 * kenyszeriti ki, hogy a lap VALASSZON, nem azt, hogy JOL valasszon. Egy lap,
 * ami allandoan `loaded`-ot ad, holott lehet ures, ugyanugy hazudna -- es ezt
 * LEMERTEM: a tipusellenorzes atengedi, mert a `loaded` ervenyes ertek, es
 * egyetlen teszt sem fogja meg. Az a hiba a kod olvasasakor latszik, nem
 * kapun.
 *
 * Amit a kotelezoseg TENYLEG ad: nincs nema alapertelmezes. A valasztas
 * lathato a hivasi helyen, tehat van MIT elolvasni -- egy elhagyott prop
 * eseten nem lenne.
 */
export type ServiceOfflineState =
  /** Van mar betoltott tartalom a kepernyon: az LATSZIK, csak nem frissul. */
  | { kind: "loaded" }
  /** Meg semmi nem toltodott be: a lap ures, es EZ az oka. */
  | { kind: "empty" }
  /**
   * Urlap: nincs mit frissiteni, a tet a mentes.
   *
   * ES A MONDATA NEM IGERHET VARAKOZO MENTEST. Az elso valtozat azt mondta,
   * hogy "a mentes csak akkor MEGY AT, ha a kapcsolat visszajon" -- az ugy
   * olvashato, hogy a mentes VAR es majd atmegy. Nem var: a weben nulla
   * ujraprobalkozas es nulla helyi sor all a mentes mogott, lemerve.
   *
   * Ugyanaz az igeret volt, amit a prototipus "N modositas feltoltesre var"
   * mondatabol KIVETTUNK -- csak masik allapotba bujva. A szabaly a fajl
   * tetején all, es megsem allitotta meg magat masodszor sem.
   */
  | { kind: "form" };

/**
 * EXPORTALT, ES NEM KENYELEMBOL: az orzoje a KULCSAIT jarja vegig.
 *
 * Igy egy UJ `kind` a felvetele napjan kap ort, nem akkor, amikor valaki
 * eszreveszi. A harmadik allapot (`form`) ugy szuletett, hogy a szabaly a fajl
 * tetejen allt es megsem allitotta meg magat -- a negyedik ugyanigy szuletne.
 * (acrobot javaslata, 2026-09-15.)
 */
export const SZOVEG: Record<ServiceOfflineState["kind"], string> = {
  loaded:
    "Nincs internet. A legutóbb betöltött adatokat látod, frissíteni csak kapcsolat után tudjuk.",
  empty: "Nincs internet. Ezért nem tudtuk betölteni az adatokat.",
  form: "Nincs internet. Amíg vissza nem jön, a mentés nem sikerül.",
};

export function ServiceOfflineNotice({
  state,
}: {
  state: ServiceOfflineState;
}) {
  /**
   * A KIINDULAS MINDIG "ONLINE", ES EZ NEM OVATOSSAG, HANEM KENYSZER: a
   * kiszolgalon nincs `navigator`, tehat az elso rajzolas nem tudhatja az
   * allapotot. Ha itt talalgatnank, a hidratalas ket kulonbozo fat hasonlitana
   * ossze. Az igazi ertek a beallas utan, az effektben erkezik.
   */
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!window.navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="mb-5 flex items-center gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700"
    >
      <ServiceIcon name="offline" className="size-4 shrink-0" />
      <span>{SZOVEG[state.kind]}</span>
    </div>
  );
}
