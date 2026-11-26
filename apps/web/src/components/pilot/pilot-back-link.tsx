import { Icon } from "@acropora/ui";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A VISSZALÉPÉS EGY ALAKJA (Picasso képernyő-leltár R12, acrobot 62415; a minta a 3.16 óta: új munkalap, új eszköz, akvárium, sablonok): kis
 * "‹" nyíl a cím FÖLÖTT, BAL felül, a cél nevével vagy a „Vissza" szóval. A leltár négy alakot talált (bal felső nyíl, morzsa, jobb felső „Vissza a
 * listához" gomb, semmi): a nyíl volt a többség (34 oldal, a morzsa egyetlen komponensen sem közös), ezért az áll.
 *
 * LINK, NEM GOMB: a visszalépés egy útvonal, nem művelet (a `useReturnTo` az előző lap címét adja, ha van). A gombsor „Mégse"-je más helyzetre való
 * (végigolvastad az űrlapot és nem viszed végig), azt ez nem helyettesíti. A forrás-őrző (`no-hand-written-back-link.test.ts`) tiltja a kézzel írt
 * változatot.
 */
export const PILOT_BACK_LINK_CLASSES =
  "mb-3 flex items-center gap-1.5 text-xs text-pilot-grey-400 transition-colors hover:text-pilot-grey-700";

export function PilotBackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={PILOT_BACK_LINK_CLASSES}>
      <Icon name="chevron-left" size={12} />
      {children}
    </Link>
  );
}

/** A felirat: „Vissza", ha az előző lapról jöttünk (a cél az a lap), különben a lista neve (a tartalék cél). */
export function backLinkLabel(
  back: { fromWithinApp: boolean },
  listName: string,
): string {
  return back.fromWithinApp ? "Vissza" : listName;
}
