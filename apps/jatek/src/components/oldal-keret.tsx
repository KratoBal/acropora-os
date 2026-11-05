import type { ReactNode } from "react";

/** A lapok kozos kerete: fejlec, tartalom, lablec. Csak a `jatek-*` osztalyokat ismeri (a kinezet cserelheto). */
export function OldalKeret({ children }: { children: ReactNode }) {
  return (
    <div className="jatek-oldal">
      <header className="jatek-fej">
        <h1 className="jatek-cim">Acropora nyereményjáték</h1>
        <p className="jatek-alcim">
          Hetente egy kérdés, heti sorsolás, karácsonyi fődíj.
        </p>
      </header>
      <main>{children}</main>
      <footer className="jatek-lablec">
        <a href="/">Heti kérdés</a>
        <a href="/jatekszabalyzat">Játékszabályzat</a>
        <a href="/adatkezeles">Adatkezelési tájékoztató</a>
      </footer>
    </div>
  );
}
