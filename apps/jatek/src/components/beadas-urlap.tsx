"use client";

import { type FormEvent, useState } from "react";

import type { Kerdes } from "../lib/jatek-api.js";

type Allapot =
  | { fajta: "var" }
  | { fajta: "kuldes" }
  | { fajta: "elkuldve"; uzenet: string }
  | { fajta: "hiba"; uzenet: string };

/**
 * A BEKULDO URLAP. E-mail-cim + valasz (szabad szoveg VAGY valasztas), rejtett botcsapda-mezo (`website`: CSS-sel
 * elrejtve, `tabIndex=-1`, `autoComplete=off`, uresen kell menjen), es a beküldés a lap SAJAT `/api/bekuldes`
 * utvonalara megy (az api cimet a szerver tudja).
 *
 * NINCS HIRLEVEL-JELOLONEGYZET (Balazs, 2026-11-05 20:51: "nem kerem"). Az urlap SEMMIT nem mond a valasz
 * helyessegerol, es nem arulja el, hogy egy cim jatszott-e mar: ugyanaz a "levelet kuldtunk" uzenet jon.
 */
export function BeadasUrlap({ kerdes }: { kerdes: Kerdes }) {
  const [email, setEmail] = useState("");
  const [valasz, setValasz] = useState("");
  const [csali, setCsali] = useState("");
  const [allapot, setAllapot] = useState<Allapot>({ fajta: "var" });

  async function kuld(esemeny: FormEvent<HTMLFormElement>) {
    esemeny.preventDefault();
    setAllapot({ fajta: "kuldes" });
    try {
      const valaszHttp = await fetch("/api/bekuldes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: kerdes.id,
          email,
          answer: valasz,
          website: csali,
        }),
      });
      const test = (await valaszHttp.json()) as {
        ok?: boolean;
        message?: string;
      };
      const uzenet = typeof test.message === "string" ? test.message : "";
      setAllapot(
        test.ok
          ? { fajta: "elkuldve", uzenet }
          : {
              fajta: "hiba",
              uzenet:
                uzenet ||
                "A játék most nem érhető el. Kérjük, próbáld újra egy kicsit később.",
            },
      );
    } catch {
      setAllapot({
        fajta: "hiba",
        uzenet:
          "A játék most nem érhető el. Kérjük, próbáld újra egy kicsit később.",
      });
    }
  }

  if (allapot.fajta === "elkuldve")
    return (
      <p className="jatek-uzenet" data-fajta="ok" role="status">
        {allapot.uzenet}
      </p>
    );

  return (
    <form className="jatek-urlap" onSubmit={kuld} noValidate={false}>
      <div className="jatek-mezo">
        <label htmlFor="jatek-email">E-mail-cím</label>
        <input
          id="jatek-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {kerdes.type === "CHOICE" ? (
        <fieldset className="jatek-mezo">
          <legend>Válassz egyet</legend>
          {kerdes.options.map((lehetoseg) => (
            <label key={lehetoseg.id} className="jatek-valasztas">
              <input
                type="radio"
                name="valasz"
                value={lehetoseg.id}
                required
                checked={valasz === lehetoseg.id}
                onChange={() => setValasz(lehetoseg.id)}
              />
              {lehetoseg.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="jatek-mezo">
          <label htmlFor="jatek-valasz">A válaszod</label>
          <input
            id="jatek-valasz"
            name="valasz"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            value={valasz}
            onChange={(e) => setValasz(e.target.value)}
          />
        </div>
      )}

      <div className="jatek-csali" aria-hidden="true">
        <label htmlFor="jatek-website">Weboldal (ezt hagyd üresen)</label>
        <input
          id="jatek-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={csali}
          onChange={(e) => setCsali(e.target.value)}
        />
      </div>

      {allapot.fajta === "hiba" ? (
        <p className="jatek-uzenet" data-fajta="hiba" role="alert">
          {allapot.uzenet}
        </p>
      ) : null}

      <button
        className="jatek-gomb"
        type="submit"
        disabled={allapot.fajta === "kuldes"}
      >
        {allapot.fajta === "kuldes" ? "Küldés…" : "Beküldöm"}
      </button>
      <p className="jatek-megjegyzes">
        Az e-mail-címedet csak a játékra és a nyertes értesítésére használjuk.
        Részletek: a <a href="/jatekszabalyzat">játékszabályzat</a> és az{" "}
        <a href="/adatkezeles">adatkezelési tájékoztató</a>.
      </p>
    </form>
  );
}
