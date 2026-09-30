"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * EGY LISTA ÁLLAPOTA AZ URL-BEN (Balázs kérése, 2026-09-30: „bármilyen
 * listába belépünk és ott beállítunk egy szűrést ... a szűrés maradjon meg és
 * az oldal is").
 *
 * Az URL az EGYETLEN forrás, nincs mellette helyi másolat: a navigációs nyom
 * a teljes címet tartja (#1264), tehát ami az URL-ben áll, az a "Vissza"
 * gombbal visszajön. Egy helyi állapot, ami csak induláskor olvas az URL-ből,
 * két forrás lenne, és a kettő elválna.
 *
 * EGY HÍVÁS TÖBB KULCSOT ÍRHAT, és ez nem kényelem: a szűrő-váltás a lapszámot
 * is nullázza. Két külön írás ugyanabból a régi URL-ből indulna, és a második
 * felülírná az elsőt.
 */
export function useUrlQuery() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  /** `null` vagy az alapérték törli a kulcsot: az alapnézet URL-je tiszta. */
  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      if (query === params.toString()) return;
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [params, pathname, router],
  );

  return { params, update };
}

/**
 * EGY KULCS ÉRTÉKE, CSAK AZ ENGEDETT ÉRTÉKEKBŐL. Egy kézzel átírt vagy régi
 * link ismeretlen értéke az alapnézetet adja, nem egy üres listát, amit semmi
 * nem magyaráz.
 */
export function urlChoice<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = params.get(key);
  return value !== null && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Pozitív egész (lapszám) az URL-ből, különben a tartalék. */
export function urlPage(params: URLSearchParams, key = "page"): number {
  const value = Number(params.get(key));
  return Number.isInteger(value) && value >= 1 ? value : 1;
}
