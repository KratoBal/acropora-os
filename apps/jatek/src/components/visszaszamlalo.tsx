"use client";

import { useEffect, useState } from "react";

/**
 * A VALASZADASI IDO VISSZASZAMLALOJA: a mostani kerdes zarasanak (`closesAt`) pillanataig. A szerver renderelese
 * "--"-t ir (a bongeszo ideje nem ismert), a betoltes utan masodpercenkent frissul; lezaras utan csupa nulla.
 */
const NAP = 86_400_000;
const ORA = 3_600_000;
const PERC = 60_000;

export function reszek(hatravan: number): {
  nap: number;
  ora: number;
  perc: number;
  mp: number;
} {
  const ms = Math.max(0, hatravan);
  return {
    nap: Math.floor(ms / NAP),
    ora: Math.floor((ms % NAP) / ORA),
    perc: Math.floor((ms % ORA) / PERC),
    mp: Math.floor((ms % PERC) / 1000),
  };
}

const ketjegy = (n: number) => String(n).padStart(2, "0");

export function Visszaszamlalo({
  closesAt,
  cimke = "Visszaszámláló a kérdés zárásáig",
}: {
  /** a cél pillanat (a nyitás vagy a zárás) */
  closesAt: string;
  cimke?: string;
}) {
  const [most, setMost] = useState<number | null>(null);
  useEffect(() => {
    setMost(Date.now());
    const id = setInterval(() => setMost(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const zaras = new Date(closesAt).getTime();
  const r = most === null || Number.isNaN(zaras) ? null : reszek(zaras - most);
  const ertek = (n: number | undefined) =>
    n === undefined ? "--" : ketjegy(n);
  return (
    <div
      className="jatek-timer"
      data-testid="visszaszamlalo"
      role="timer"
      aria-label={cimke}
    >
      <span>
        <b>{ertek(r?.nap)}</b>
        <small>NAP</small>
      </span>
      <i>:</i>
      <span>
        <b>{ertek(r?.ora)}</b>
        <small>ÓRA</small>
      </span>
      <i>:</i>
      <span>
        <b>{ertek(r?.perc)}</b>
        <small>PERC</small>
      </span>
      <i>:</i>
      <span>
        <b>{ertek(r?.mp)}</b>
        <small>MP</small>
      </span>
    </div>
  );
}
