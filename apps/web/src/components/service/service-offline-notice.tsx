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
export function ServiceOfflineNotice() {
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
      <span>
        Nincs internet. A legutóbb betöltött adatokat látod, frissíteni csak
        kapcsolat után tudjuk.
      </span>
    </div>
  );
}
