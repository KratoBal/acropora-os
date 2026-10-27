"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { favoritesApi } from "@/lib/api/favorites";

export interface Favorites {
  /** A kedvenc útvonalak a megjelölés sorrendjében. */
  hrefs: string[];
  isFavorite: (href: string) => boolean;
  /** Megjelöli vagy kiveszi; a képernyő azonnal változik, a mentés mögötte fut. */
  toggle: (href: string) => void;
  /**
   * A lista megérkezett (vagy a betöltés elbukott). Addig a csillag nem
   * kapcsolható: egy korai kattintást a késve érkező szerverlista felülírna, és
   * a kattintás szándéka (megjelöl vagy kivesz) a még ismeretlen állapoton múlna.
   */
  ready: boolean;
  /** A legutóbbi mentés nem sikerült (a lista visszaállt a szerver állapotára). */
  failed: boolean;
}

/**
 * A KEDVENCEK a szerverről (felhasználónként, minden eszközön ugyanaz).
 *
 * A kattintás azonnal átbillenti a csillagot, a mentés a háttérben fut, és a
 * KATTINTÁSOK SORRENDJÉBEN: két gyors kattintás két kérés, és a szerver is
 * ugyanabban a sorrendben kapja. Ha egy mentés elbukik, a lista a szerver
 * állapotára áll vissza, és `failed` jelzi, hogy nem sikerült: a csillag nem
 * maradhat bejelölve olyasmire, ami nincs elmentve.
 *
 * A betöltés hibája nem akasztja a keretet: üres listával megy tovább (nincs
 * Kedvencek menü), és a következő betöltésnél újra próbálja.
 */
export function useFavorites(token: string, enabled: boolean): Favorites {
  const [hrefs, setHrefs] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const current = useRef<string[]>([]);

  const apply = useCallback((next: string[]) => {
    current.current = next;
    setHrefs(next);
  }, []);

  useEffect(() => {
    setReady(false);
    if (!enabled) {
      apply([]);
      return;
    }
    const controller = new AbortController();
    void favoritesApi
      .list(token, controller.signal)
      .then((response) => apply(response.items))
      .catch(() => {
        // a lista üres marad; a kereten nem múlik semmi
      })
      .finally(() => {
        if (!controller.signal.aborted) setReady(true);
      });
    return () => controller.abort();
  }, [enabled, token, apply]);

  const toggle = useCallback(
    (href: string) => {
      const marked = current.current.includes(href);
      apply(
        marked
          ? current.current.filter((item) => item !== href)
          : [...current.current, href],
      );
      setFailed(false);
      queue.current = queue.current.then(async () => {
        try {
          if (marked) await favoritesApi.remove(token, href);
          else await favoritesApi.add(token, href);
        } catch {
          setFailed(true);
          try {
            apply((await favoritesApi.list(token)).items);
          } catch {
            // marad az utolsó ismert állapot
          }
        }
      });
    },
    [token, apply],
  );

  const isFavorite = useCallback(
    (href: string) => hrefs.includes(href),
    [hrefs],
  );

  return { hrefs, isFavorite, toggle, ready, failed };
}
