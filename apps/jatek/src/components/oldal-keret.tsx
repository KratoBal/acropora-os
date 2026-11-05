import type { ReactNode } from "react";

/**
 * A LAPOK KOZOS KERETE (Luca designja, 2026-11-05): ugras-link, a (csak hamis api-nal latszo) proba-sav, fejlec a
 * logoval es a menuvel, a tartalom, a lablec es a mobilon rogzitett "Ugras a heti kerdeshez" gomb. A menu a
 * fooldal szakaszaira mutat (`/#...`), igy a jogi lapokrol is mukodik. Csak a `jatek-*` osztalyokat ismeri.
 */
export function OldalKeret({
  children,
  proba = false,
}: {
  children: ReactNode;
  /** a hamis api jelzese: "Probauzem" sav a lap tetejen */
  proba?: boolean;
}) {
  return (
    <>
      <a className="jatek-skip" href="/#heti-kerdes">
        Ugrás a heti kérdéshez
      </a>
      {proba ? (
        <div className="jatek-demo-bar" data-testid="proba-jelzes">
          <span className="jatek-dot" /> PRÓBAÜZEM{" "}
          <span>· a kérdés és a beküldés még nem valódi</span>
        </div>
      ) : null}
      <header className="jatek-wrap">
        <a
          className="jatek-brand"
          href="/"
          aria-label="Acropora nyereményjáték, kezdőlap"
        >
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <path d="M20 36V18M20 26L8 15M9 16V7M9 14L3 10M20 20L30 10M30 13V3M29 12L37 8M20 18L17 7M17 10L11 4" />
          </svg>
          <span>
            ACROPORA<small>A TENGER EGY KARNYÚJTÁSNYIRA</small>
          </span>
        </a>
        <nav aria-label="Fő navigáció">
          <a href="/#fodij">A fődíj</a>
          <a href="/#hogyan">Így játszhatsz</a>
          <a href="/#nyertesek">Nyertesek</a>
        </nav>
        <a className="jatek-button jatek-small" href="/#heti-kerdes">
          Heti kérdés <span>↗</span>
        </a>
      </header>
      <main>{children}</main>
      <footer className="jatek-wrap">
        <a className="jatek-brand" href="/">
          ACROPORA<span className="jatek-footer-dot">●</span>
        </a>
        <span>Egy kis óceán. Egy nagy közösség.</span>
        <div>
          <a className="jatek-inline" href="/jatekszabalyzat">
            Játékszabályzat
          </a>
          <a className="jatek-inline" href="/adatkezeles">
            Adatkezelés
          </a>
        </div>
        <small>jatek.acropora.hu</small>
      </footer>
      <a href="/#heti-kerdes" className="jatek-mobile-cta jatek-button">
        Ugrás a heti kérdéshez <span>↗</span>
      </a>
    </>
  );
}
