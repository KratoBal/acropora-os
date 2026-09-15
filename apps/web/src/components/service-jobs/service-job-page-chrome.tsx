import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A HIBAJEGY-OLDALAK FEJLÉCE ÉS ELSŐDLEGES GOMBJA.
 *
 * MIÉRT NEM A KÖZÖS `PageHeader` ÉS `Button`, ÉS MIÉRT NEM IS AZOKAT ÍRTAM ÁT:
 *
 * A terv hangsúlya LILA, a mai felületé pedig türkiz (a `PageHeader` felső
 * sora) és sötét (a `Button` elsődleges alakja). Ez a kör SZÁNDÉKOSAN csak a
 * hibajegy-oldalakra szól, tehát a közös komponensek átírása tizennégy másik
 * oldalt is elmozdítana - olyanokat, amiket ebben a körben senki nem néz meg.
 *
 * A MÁSIK IRÁNY VISZONT ROSSZABB: ha a közös fejlécet hagynám itt, EGY OLDALON
 * BELÜL állna kétféle hangsúly - türkiz felső sor lila fülek fölött. Az nem
 * félkész tervnek látszik, hanem hibának, és épp azt a kérdést fedné el, amire
 * ebben a körben választ várunk.
 *
 * Tehát a varrat OLDALAK KÖZÖTT húzódik, nem oldalon belül. Amikor a terv a
 * többi oldalra is átkerül, ezek a komponensek NEM maradnak: a közös
 * `PageHeader` és `Button` veszi át a szerepüket, egyszer, mindenhol.
 *
 * (A `cn` a közös csomagban egyszerű összefűzés, nem tailwind-merge: egy
 * `className`-mel felülírt `bg-slate-900` a stíluslap sorrendjén múlna. Ezért
 * itt saját elem áll, nem a közös gomb felülstílusozása.)
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
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-violet-700">
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

export function ServiceJobPrimaryLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
    >
      {children}
    </Link>
  );
}
