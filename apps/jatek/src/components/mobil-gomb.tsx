"use client";

import { useEffect, useState } from "react";

/**
 * A heti kerdes szakasz es a gomb viszonya: a gomb akkor kell, ha a kerdes meg NEM latszik es meg NEM maradt el
 * (a lap tetejen, vagy a hero alatt). Ha a szakasz a kepernyon van, vagy mar folotte jart a lapozas, a gomb csak
 * letakarna a szoveget (Balazs, 2026-11-06: a rogzitett gomb a fodij-kartya szovegere ult).
 */
export const gombLatszik = (allapot: {
  metszi: boolean;
  tetejeFelett: boolean;
}): boolean => !allapot.metszi && !allapot.tetejeFelett;

/** A mobilon rogzitett "Ugras a heti kerdeshez" gomb. A lapokon, ahol nincs heti kerdes szakasz, mindig latszik. */
export function MobilGomb() {
  const [latszik, setLatszik] = useState(true);

  useEffect(() => {
    const cel = document.getElementById("heti-kerdes");
    if (!cel || typeof IntersectionObserver === "undefined") return;
    const figyelo = new IntersectionObserver(([e]) => {
      if (!e) return;
      setLatszik(
        gombLatszik({
          metszi: e.isIntersecting,
          tetejeFelett: !e.isIntersecting && e.boundingClientRect.bottom < 0,
        }),
      );
    });
    figyelo.observe(cel);
    return () => figyelo.disconnect();
  }, []);

  return (
    <a
      href="/#heti-kerdes"
      className="jatek-mobile-cta jatek-button"
      data-rejtett={latszik ? undefined : "true"}
      aria-hidden={latszik ? undefined : true}
      tabIndex={latszik ? undefined : -1}
    >
      Ugrás a heti kérdéshez <span>↗</span>
    </a>
  );
}
