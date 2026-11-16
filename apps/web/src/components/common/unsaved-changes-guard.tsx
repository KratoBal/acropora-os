"use client";

import { ConfirmDialog } from "@acropora/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * AZ ELMENTETLEN VÁLTOZÁS ŐRE, AZ ALKALMAZÁSON BELÜLI KILÉPÉSRE IS (Luca, 2026-11-13: „akkor lépek ki, amikor
 * vevő jön, és az oldalsávval teszem"; barracuda, #2531 review). A böngésző `beforeunload` kérdése csak a lap
 * bezárásánál és az újratöltésnél fut le, a Next-router átlépéseinél (oldalsáv, bármelyik link) nem, ezért
 * ott a mentetlen tétel jelzés nélkül elveszne.
 *
 * MÓDJA: amíg `when` igaz, egy dokumentum-szintű, elfogó (capture) kattintás-figyelő minden azonos származású
 * hivatkozásra megáll, és a közös `ConfirmDialog`-ot nyitja; megerősítésre a router viszi tovább ugyanoda.
 * A módosított kattintás (Ctrl, Cmd, Shift, Alt, középső gomb), az új lapon nyíló és a letöltő hivatkozás, a
 * külső cím és az ugyanazon oldalra mutató (csak a #horgony változik) hivatkozás nem áll meg.
 *
 * AMIT EZ NEM FOG MEG, kimondva: a böngésző Vissza gombját (a Next a `popstate`-nél már elvitte az oldalt, mire
 * bármi futhatna), és a gombról indított `router.push` hívásokat. Az előbbi csak előzmény-bejegyzés
 * beszúrásával védhető, ami a `navigation-history` modullal együtt kockázatosabb, mint amit a mai igény kíván.
 */
export function UnsavedChangesGuard({
  when,
  title = "Kilépsz a mentetlen változtatásokkal?",
  consequence = "A még nem mentett változtatások elvesznek.",
  recovery = "Nem szerezhetők vissza: az adat a legutóbbi mentett állapotában marad.",
  confirmLabel = "Kilépés mentés nélkül",
}: {
  /** van-e elmentetlen változás */
  when: boolean;
  title?: string;
  consequence?: string;
  recovery?: string;
  confirmLabel?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!when) {
      setPending(null);
      return;
    }
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (event.target as Element | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute("download")) return;
      if (anchor.target && anchor.target !== "_self") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      setPending(`${url.pathname}${url.search}${url.hash}`);
    };
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", warn);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", warn);
    };
  }, [when]);

  return (
    <ConfirmDialog
      open={pending !== null}
      title={title}
      consequence={consequence}
      recovery={recovery}
      confirmLabel={confirmLabel}
      onConfirm={() => {
        const href = pending;
        setPending(null);
        if (href) router.push(href);
      }}
      onCancel={() => setPending(null)}
    />
  );
}
