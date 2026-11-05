"use client";

import { useEffect, useState } from "react";

type Allapot =
  | { fajta: "var" }
  | { fajta: "ok"; uzenet: string }
  | { fajta: "hiba"; uzenet: string };

/**
 * A MEGEROSITES: a lap betoltesekor EGY POST a sajat `/api/megerosites` utvonalra (a token a level linkjebol jon).
 * Szandekosan bongeszoben, nem a szerver renderelesekor: egy level-ellenorzo vagy linkelozetes, ami csak
 * lekeri a lapot, de nem futtat JavaScriptet, nem erosit meg semmit.
 */
export function MegerositesAllapot({ token }: { token: string }) {
  const [allapot, setAllapot] = useState<Allapot>({ fajta: "var" });

  useEffect(() => {
    let megszakitva = false;
    (async () => {
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
        if (megszakitva) return;
        const uzenet = typeof test.message === "string" ? test.message : "";
        setAllapot(
          test.ok
            ? { fajta: "ok", uzenet }
            : {
                fajta: "hiba",
                uzenet:
                  uzenet ||
                  "A megerősítés most nem sikerült. Próbáld újra később.",
              },
        );
      } catch {
        if (!megszakitva)
          setAllapot({
            fajta: "hiba",
            uzenet: "A megerősítés most nem sikerült. Próbáld újra később.",
          });
      }
    })();
    return () => {
      megszakitva = true;
    };
  }, [token]);

  if (allapot.fajta === "var")
    return (
      <p className="jatek-uzenet" role="status">
        A részvételed megerősítése folyamatban van…
      </p>
    );
  return (
    <p
      className="jatek-uzenet"
      data-fajta={allapot.fajta}
      role={allapot.fajta === "hiba" ? "alert" : "status"}
    >
      {allapot.uzenet}
    </p>
  );
}
