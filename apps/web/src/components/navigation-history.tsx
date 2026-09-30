"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  advanceTrail,
  lastVisitOf,
  previousPage,
} from "@/lib/navigation/return-trail";

const NavigationHistoryContext = createContext<{
  previous: string | null;
  trail: readonly string[];
}>({
  previous: null,
  trail: [],
});

/**
 * Megjegyzi, honnan jött a felhasználó, az appon BELÜL.
 *
 * A böngésző előzménye erre nem jó: közvetlen címmel megnyitott lapról egy
 * visszalépés kilépne az alkalmazásból, és nincs megbízható módja megtudni,
 * van-e hova visszamenni. Ez a nyom viszont csak azt tartalmazza, amit ebben
 * a munkamenetben, ezen a felületen bejártunk.
 */
export function NavigationHistoryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [trail, setTrail] = useState<string[]>([]);

  /*
    A NYOM A TELJES CÍMET TARTJA, A QUERYVEL EGYÜTT: a lista szűrése és oldala
    az URL-ben él, és a "vissza" csak így viszi vissza őket (Balázs kérése,
    2026-09-30). A query a lap-váltásnál és a szűrő-váltásnál is frissül.
  */
  useEffect(() => {
    const href = search ? `${pathname}?${search}` : pathname;
    setTrail((current) => advanceTrail(current, href));
  }, [pathname, search]);

  const value = useMemo(
    () => ({ previous: previousPage(trail), trail }),
    [trail],
  );

  return (
    <NavigationHistoryContext.Provider value={value}>
      {/*
        A `useSearchParams` egy saját, Suspense alatti gyerekben él: így a
        Next.js kliens-oldali visszaesése csak ezt a láthatatlan elemet
        érinti, nem a teljes héjat.
      */}
      <Suspense fallback={null}>
        <SearchTracker onChange={setSearch} />
      </Suspense>
      {children}
    </NavigationHistoryContext.Provider>
  );
}

function SearchTracker({ onChange }: { onChange: (search: string) => void }) {
  const search = useSearchParams().toString();
  useEffect(() => onChange(search), [onChange, search]);
  return null;
}

export interface ReturnTarget {
  /** Ahova a "vissza" visz: az előző lap, vagy a hívó tartaléka. */
  href: string;
  /** Igaz, ha tényleg volt honnan jönni. A felirat ettől függhet. */
  fromWithinApp: boolean;
  /** Sikeres művelet vagy Mégsem után ezt kell hívni. */
  goBack(): void;
}

/**
 * Sikeres mentés, törlés, rögzítés vagy Mégsem után hova.
 *
 * A TARTALÉK CÉL A HÍVÁSI HELYEN ÁLL, szándékosan, és nem egy központi
 * táblázatban: a gomb ma is tudja, hova menne, és egy központi tábla harmadik
 * forrásává válna ugyanannak, amit a képernyő már kimond. A következő új
 * képernyőnél azt felejtenénk el frissíteni.
 */
export function useReturnTo(fallbackHref: string): ReturnTarget {
  const { previous } = useContext(NavigationHistoryContext);
  const router = useRouter();

  const fromWithinApp = previous !== null;
  const href = fromWithinApp ? previous : fallbackHref;

  return {
    href,
    fromWithinApp,
    goBack: () => router.push(href),
  };
}

/**
 * Egy lista címe a legutóbbi szűrésével és oldalával, ha a munkamenetben
 * már járt ott, különben a puszta útvonal. Morzsamenühöz és "a listához"
 * linkhez, ahol nem az előző lap a cél, hanem maga a lista.
 */
export function useListHref(listPath: string): string {
  const { trail } = useContext(NavigationHistoryContext);
  return lastVisitOf(trail, listPath) ?? listPath;
}
