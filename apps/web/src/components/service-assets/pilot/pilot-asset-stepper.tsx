"use client";

import { Icon } from "@acropora/ui";
import type { AssetListNeighbors } from "@acropora/types";
import { useEffect, useState } from "react";

import { useListHref } from "@/components/navigation-history";
import { PilotButton } from "@/components/pilot/pilot-ui";
import { assetsApi } from "@/lib/api/assets";
import { ASSET_LIST_PATH, assetListQueryFromHref } from "./asset-list-query";

/**
 * AZ ADATLAP ELŐZŐ/KÖVETKEZŐ GOMBJA (Balázs kérése, 2026-09-30 12:29 UTC):
 * "ha belépek az eszközbe, akkor a lap tetején és alján legyen egy Előző és
 * egy Következő gomb".
 *
 * A LISTA SZŰRÉSÉVEL ÉS SORRENDJÉVEL LÉP: a kérés a lista legutóbbi címéből
 * jön (a navigációs nyomból), ugyanazokkal az alapértékekkel, mint a listáé.
 * Ha a munkamenetben nem jártak a listán, a lista alapnézete (Beépített, név
 * szerint) a sorrend. A szomszédot a szerver adja, tehát a lapszélen is
 * átlép a következő lapra.
 */
export function useAssetNeighbors(
  token: string,
  assetId: string,
  enabled: boolean,
): AssetListNeighbors | null {
  const listHref = useListHref(ASSET_LIST_PATH);
  const query = assetListQueryFromHref(listHref).toString();
  const [neighbors, setNeighbors] = useState<AssetListNeighbors | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setNeighbors(null);
    assetsApi
      .neighbors(token, assetId, new URLSearchParams(query), controller.signal)
      .then(setNeighbors)
      // EGY ELMARADT SZOMSZÉD NEM HIBA AZ ADATLAPON: a gombok tiltottak
      // maradnak, az adatlap maga működik tovább.
      .catch(() => {});
    return () => controller.abort();
  }, [assetId, enabled, query, token]);

  return neighbors;
}

/**
 * A GOMBPÁR. Amíg a szomszédok nem jöttek meg, és a lista két végén, a
 * megfelelő gomb tiltott.
 */
export function PilotAssetStepper({
  neighbors,
  onStep,
  position,
}: {
  neighbors: AssetListNeighbors | null;
  onStep: (assetId: string) => void;
  /** Melyik példány: a lap teteje vagy alja, a két gombpár megkülönböztetéséhez. */
  position: "top" | "bottom";
}) {
  const previousId = neighbors?.previousId ?? null;
  const nextId = neighbors?.nextId ?? null;
  return (
    <nav
      aria-label={
        position === "top" ? "Lapozás az eszközök között" : "Lapozás (lap alja)"
      }
      className="flex items-center gap-2"
    >
      <PilotButton
        variant="secondary"
        size="action"
        disabled={previousId === null}
        onClick={() => previousId && onStep(previousId)}
      >
        <Icon name="chevron-left" size={12} />
        Előző
      </PilotButton>
      <PilotButton
        variant="secondary"
        size="action"
        disabled={nextId === null}
        onClick={() => nextId && onStep(nextId)}
      >
        Következő
        <Icon name="chevron-left" size={12} className="rotate-180" />
      </PilotButton>
    </nav>
  );
}
