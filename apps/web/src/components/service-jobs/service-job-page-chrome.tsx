import type { ReactNode } from "react";

/**
 * EGY SZAMOZOTT LEPES A FELVITELI URLAPON.
 *
 * A SZAM SZINE A KOZOS SZERVIZ-PALETTABOL JON (`sv`), nem beegetett osztalybol:
 * a markaszin egy helyen all, a `components/service/service-theme.ts` fajlban.
 *
 * ES EZ A FAJL AZERT MARADT MEG, MERT A LEPES-KARTYANAK NINCS KOZOS PARJA. A
 * kozos reteg a LISTAK kulsojet adja (fejlec, fulek, csempek, jelveny, lablec);
 * a felviteli urlap szamozott lepese sehol masutt nem fordul elo. Ha egyszer
 * masik urlap is kap ilyet, ennek a helye is ott lesz.
 *
 * A LEPESEK SZAMA NEM A MEZOKET FOGYASZTJA, HANEM A SORRENDET MONDJA KI. A
 * felvitel sorrendje itt TARTALMI kerdes (a helyszin a partnertol fugg), es
 * eddig egyetlen hosszu kartya vitte -- azon a lapon a fuggoseg nem latszott,
 * csak a mezok egymasutanja.
 *
 * NEM TABLAP ES NEM VARAZSLO: minden lepes egyszerre lathato, es barmelyik
 * kitoltheto elsokent. A szam a SORRENDET javasolja, nem kikenyszeriti -- egy
 * varazslo itt tobbet venne el (vissza-elore lepkedes), mint amennyit adna.
 */
export function ServiceJobStepCard({
  children,
  number,
  title,
}: {
  children: ReactNode;
  number: string;
  title: string;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-6 items-center rounded-md bg-brand-100 px-2 text-[11px] font-bold tracking-[0.08em] text-brand-700"
        >
          {number}
        </span>
        <h2 className="text-base font-bold tracking-tight text-slate-950">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
