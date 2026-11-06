"use client";

import { type FormEvent, useState } from "react";

import type { Kerdes } from "../lib/jatek-api.ts";

type Allapot =
  | { fajta: "var" }
  | { fajta: "kuldes" }
  | { fajta: "elkuldve"; uzenet: string }
  | { fajta: "hiba"; uzenet: string };

const NEM_ELERHETO =
  "A játék most nem érhető el. Kérjük, próbáld újra egy kicsit később.";

/**
 * A BEKULDO URLAP (Luca designja, 2026-11-05). E-mail-cim + valasz (szabad szoveg VAGY valasztas), rejtett
 * botcsapda-mezo (`website`: a kepernyon kivulre tolva, `tabIndex=-1`, `autoComplete=off`, uresen kell menjen), es
 * EGY kotelezo jelolonegyzet: "Elfogadom a jatekszabalyzatot, es megismertem az adatkezelesi tajekoztatot".
 * A beküldés a lap SAJAT `/api/bekuldes` utvonalara megy (az api cimet a szerver tudja).
 *
 * NINCS HIRLEVEL-JELOLONEGYZET (Balazs, 2026-11-05 20:51: "nem kerem"; ELTERES a designtol, amiben volt egy
 * "Szeretnek Acropora-hireket" opcio). A szabalyzat-elfogadas csak a KLIENS kapuja: az api-nak nincs ilyen mezoje
 * (a szerzodes szerint), tehat az elfogadast az api nem rogziti.
 *
 * Az urlap SEMMIT nem mond a valasz helyessegerol, es nem arulja el, hogy egy cim jatszott-e mar: ugyanaz a
 * "levelet kuldtunk" uzenet jon.
 */
export function BeadasUrlap({ kerdes }: { kerdes: Kerdes }) {
  const [email, setEmail] = useState("");
  const [valasz, setValasz] = useState("");
  const [csali, setCsali] = useState("");
  const [elfogadom, setElfogadom] = useState(false);
  const [allapot, setAllapot] = useState<Allapot>({ fajta: "var" });

  async function kuld(esemeny: FormEvent<HTMLFormElement>) {
    esemeny.preventDefault();
    if (!elfogadom) return;
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
          : { fajta: "hiba", uzenet: uzenet || NEM_ELERHETO },
      );
    } catch {
      setAllapot({ fajta: "hiba", uzenet: NEM_ELERHETO });
    }
  }

  if (allapot.fajta === "elkuldve")
    return (
      <div className="jatek-sikeres" role="status">
        <span className="jatek-success-icon">✓</span>
        <h3>Köszönjük a válaszod!</h3>
        <p>{allapot.uzenet}</p>
      </div>
    );

  return (
    <form onSubmit={kuld}>
      {kerdes.type === "CHOICE" ? (
        <fieldset className="jatek-valasztasok">
          <legend>
            A válaszod <span>*</span>
          </legend>
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
        <>
          <label htmlFor="jatek-valasz">
            A válaszod <span>*</span>
          </label>
          <input
            id="jatek-valasz"
            name="valasz"
            type="text"
            placeholder="Írd ide a válaszodat…"
            required
            maxLength={200}
            autoComplete="off"
            value={valasz}
            onChange={(e) => setValasz(e.target.value)}
          />
        </>
      )}

      <label htmlFor="jatek-email">
        E-mail-címed <span>*</span>
      </label>
      <input
        id="jatek-email"
        name="email"
        type="email"
        placeholder="pelda@example.com"
        autoComplete="email"
        required
        maxLength={254}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <small className="jatek-field-note">
        A megerősítő levelet erre a címre küldjük, a linkjével lesz érvényes a
        játékod.
      </small>

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

      <div className="jatek-consents">
        <label className="jatek-check">
          <input
            id="jatek-szabalyzat-elfogadas"
            type="checkbox"
            required
            checked={elfogadom}
            onChange={(e) => setElfogadom(e.target.checked)}
          />
          <span>
            Elfogadom a{" "}
            <a href="/jatekszabalyzat" target="_blank" rel="noopener">
              játékszabályzatot
            </a>
            , és megismertem az{" "}
            <a href="/adatkezeles" target="_blank" rel="noopener">
              adatkezelési tájékoztatót
            </a>
            . <b>* Kötelező</b>
          </span>
        </label>
      </div>

      {allapot.fajta === "hiba" ? (
        <p className="jatek-uzenet" data-fajta="hiba" role="alert">
          {allapot.uzenet}
        </p>
      ) : null}

      <button
        className="jatek-button jatek-submit"
        type="submit"
        disabled={allapot.fajta === "kuldes"}
      >
        {allapot.fajta === "kuldes" ? "Küldés…" : "Beküldöm"} <span>↗</span>
      </button>
      <p className="jatek-privacy-note">
        ◇ Az e-mail-címedet csak a játékra és a nyertes értesítésére használjuk.
      </p>
    </form>
  );
}
