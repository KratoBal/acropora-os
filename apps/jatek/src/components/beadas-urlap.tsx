"use client";

import { type FormEvent, useState } from "react";

import type { Kerdes } from "../lib/jatek-api.ts";
import { VERZIO } from "../lib/jogi-szovegek.ts";

type Allapot =
  | { fajta: "var" }
  | { fajta: "kuldes" }
  | { fajta: "elkuldve"; uzenet: string }
  | { fajta: "hiba"; uzenet: string };

const NEM_ELERHETO =
  "A játék most nem érhető el. Kérjük, próbáld újra egy kicsit később.";

/**
 * A BEKULDO URLAP (Luca designja, 2026-11-05). Nev (Balazs, 2026-11-06: kotelezo; a nyertes nevet az oldal roviditve
 * teszi kozze, ezt a mezo alatti megjegyzes mondja) + e-mail-cim + valasz (szabad szoveg VAGY valasztas), rejtett
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
  const [nev, setNev] = useState("");
  const [email, setEmail] = useState("");
  const [valasz, setValasz] = useState("");
  const [csali, setCsali] = useState("");
  // KÉT KÜLÖN, ALAPBÓL ÜRES jelölőnégyzet (adatkezelési tájékoztató 3.1): a szabályzat elfogadása és az adatkezelési hozzájárulás
  const [szabalyzat, setSzabalyzat] = useState(false);
  const [hozzajarulas, setHozzajarulas] = useState(false);
  const [allapot, setAllapot] = useState<Allapot>({ fajta: "var" });

  async function kuld(esemeny: FormEvent<HTMLFormElement>) {
    esemeny.preventDefault();
    if (!szabalyzat || !hozzajarulas) return;
    setAllapot({ fajta: "kuldes" });
    try {
      const valaszHttp = await fetch("/api/bekuldes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId: kerdes.id,
          email,
          name: nev,
          rulesAccepted: true,
          consentGiven: true,
          rulesVersion: VERZIO.szabalyzat,
          privacyVersion: VERZIO.adatkezeles,
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

      <label htmlFor="jatek-nev">
        A neved <span>*</span>
      </label>
      <input
        id="jatek-nev"
        name="nev"
        type="text"
        placeholder="Kovács Péter"
        autoComplete="name"
        required
        minLength={2}
        maxLength={120}
        value={nev}
        onChange={(e) => setNev(e.target.value)}
      />
      <small className="jatek-field-note">
        Ha te nyersz, a neved rövidítve (például Kovács P.) jelenik meg az
        oldalon.
      </small>

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
            checked={szabalyzat}
            onChange={(e) => setSzabalyzat(e.target.checked)}
          />
          <span>
            Elfogadom a{" "}
            <a href="/jatekszabalyzat" target="_blank" rel="noopener">
              játékszabályzatot
            </a>
            , beleértve, hogy nyertesség esetén a rövidített nevem, részben
            kitakart e-mail-címem és a nyereményem megjelenik a játék oldalán és
            a fődíj élő sorsolásán. <b>* Kötelező</b>
          </span>
        </label>
        <label className="jatek-check">
          <input
            id="jatek-hozzajarulas"
            type="checkbox"
            required
            checked={hozzajarulas}
            onChange={(e) => setHozzajarulas(e.target.checked)}
          />
          <span>
            Hozzájárulok, hogy az{" "}
            <a href="/adatkezeles" target="_blank" rel="noopener">
              adatkezelési tájékoztató
            </a>{" "}
            szerint kezeljétek az adataimat. <b>* Kötelező</b>
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
