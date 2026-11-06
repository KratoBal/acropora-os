"use client";

import { useState } from "react";

import { PROBA_UZENET, probaToken } from "../lib/proba-token.ts";

type Allapot =
  | { fajta: "var" }
  | { fajta: "kuldes" }
  | { fajta: "ok"; uzenet: string }
  | { fajta: "hiba"; uzenet: string };

const SIKERTELEN = "A megerősítés most nem sikerült. Próbáld újra később.";

/**
 * A MEGEROSITES: egy gomb ("Megerősítem a részvételem"), es a POST a sajat `/api/megerosites` utvonalra CSAK a
 * kattintasra megy (a token a level linkjebol jon). NEM a lap betoltesekor, es ez dontes, nem kenyelem
 * (acrobot, 2026-11-05 23:25, barracuda #2255 review): az eddigi, betolteskor induló alak a JavaScriptet nem futtato
 * linkelozetest kizarta, a JS-t futtato level-szurot (Microsoft Defender Safe Links, ceges sandboxok: bongeszoben
 * nyitjak meg a linket) NEM, es az a cim tulajdonosa helyett erositett volna meg, ami a dupla megerosites celjat
 * utotte at. A kattintast egy szuro nem vegzi el.
 */
export function MegerositesAllapot({ token }: { token: string }) {
  const [allapot, setAllapot] = useState<Allapot>({ fajta: "var" });

  // A PRÓBALEVÉL LINKJE (acrobot 44553): nincs mit megerősíteni és nincs mit küldeni az api-nak; a lap azt mondja ki, amit a
  // próba mér: a link ide ért, és a lap működik.
  if (probaToken(token))
    return (
      <p className="jatek-uzenet" data-fajta="ok" role="status">
        {PROBA_UZENET}
      </p>
    );

  async function megerosit() {
    setAllapot({ fajta: "kuldes" });
    try {
      const valasz = await fetch("/api/megerosites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const test = (await valasz.json()) as {
        ok?: boolean;
        message?: string;
      };
      const uzenet = typeof test.message === "string" ? test.message : "";
      setAllapot(
        test.ok
          ? { fajta: "ok", uzenet }
          : { fajta: "hiba", uzenet: uzenet || SIKERTELEN },
      );
    } catch {
      setAllapot({ fajta: "hiba", uzenet: SIKERTELEN });
    }
  }

  if (allapot.fajta === "ok" || allapot.fajta === "hiba")
    return (
      <p
        className="jatek-uzenet"
        data-fajta={allapot.fajta}
        role={allapot.fajta === "hiba" ? "alert" : "status"}
      >
        {allapot.uzenet}
      </p>
    );

  return (
    <div className="jatek-megerosites">
      <h1>Erősítsd meg a részvételed</h1>
      <p>
        Már csak egy lépés: a gombbal erősíted meg, hogy te adtad be ezt a
        választ. A megerősítésig a játékod nem érvényes.
      </p>
      <button
        type="button"
        className="jatek-button jatek-submit"
        onClick={() => void megerosit()}
        disabled={allapot.fajta === "kuldes"}
      >
        {allapot.fajta === "kuldes" ? "Küldés…" : "Megerősítem a részvételem"}{" "}
        <span>↗</span>
      </button>
    </div>
  );
}
