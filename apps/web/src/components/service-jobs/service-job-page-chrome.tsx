import type { ReactNode } from "react";

/**
 * A HIBAJEGY-OLDALAK FEJLÉCE.
 *
 * CSAK SZERKEZET, SEMMILYEN SAJÁT SZÍN. A terv nagyobb címet és levegősebb
 * fejlécet ad, mint a közös `PageHeader` - ez az egy dolog marad itt. A
 * hangsúly színe a MAI tokenből jön, ugyanabból, amit a közös fejléc használ.
 *
 * MIÉRT NEM A TERV LILÁJA, HOLOTT ELŐSZÖR AZ ÁLLT ITT. Az arculat (betűtípus,
 * márkaszín, sötét oldalsáv) KÜLÖN ágon készül, és az mozdítja a közös
 * fájlokat - a márkaszín ott `#6150bd`. Amit ide beírtam, az a Tailwind
 * `teal-600`, vagyis `#7c3aed`: szintén lila, és MÁS lila. Két különböző
 * lila egymás mellett semmilyen hibát nem adna, csak a hibajegy-oldalak
 * ütnének el minden más oldaltól - pontosan az a néma eltérés, aminek a
 * megelőzésére egy megosztott token létezik.
 *
 * Tehát a szín EGY helyen dől el, és az nem itt van. Amikor az arculat-ág bent
 * lesz, ezek az oldalak magukkal viszik a márkaszínt, és ehhez a fájlhoz nem
 * kell hozzányúlni.
 */
export function ServiceJobPageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  description?: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-teal-700">
          {eyebrow}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

/**
 * EGY SZAMOZOTT LEPES A FELVITELI URLAPON.
 *
 * A SZAM SZINE ITT IS A MAI TOKENBOL JON, nem a tervebol -- lasd a fenti
 * fejlec indoklasat: a markaszin az arculat-agon dol el, egy helyen.
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
          className="flex h-6 items-center rounded-md bg-teal-50 px-2 text-[11px] font-bold tracking-[0.08em] text-teal-700"
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
