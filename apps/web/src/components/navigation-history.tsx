"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { advanceTrail, previousPage } from "@/lib/navigation/return-trail";

const NavigationHistoryContext = createContext<{ previous: string | null }>({
  previous: null,
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
  const [trail, setTrail] = useState<string[]>([]);

  useEffect(() => {
    setTrail((current) => advanceTrail(current, pathname));
  }, [pathname]);

  const value = useMemo(() => ({ previous: previousPage(trail) }), [trail]);

  return (
    <NavigationHistoryContext.Provider value={value}>
      {children}
    </NavigationHistoryContext.Provider>
  );
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
