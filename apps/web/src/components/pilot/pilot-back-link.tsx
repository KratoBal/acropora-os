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

/** Ugyanaz a link, alsó margó nélkül: ahol a szülő `space-y-*` már adja a távolságot a fejlécig (a számla-lapok gyökere). */
export const PILOT_BACK_LINK_FLUSH_CLASSES = PILOT_BACK_LINK_CLASSES.replace(
  "mb-3 ",
  "",
);

export function PilotBackLink({
  href,
  children,
  flush = false,
}: {
  href: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        flush ? PILOT_BACK_LINK_FLUSH_CLASSES : PILOT_BACK_LINK_CLASSES
      }
    >
      <Icon name="chevron-left" size={12} />
      {children}
    </Link>
  );
}

/**
 * A NYÍL GOMB-VÁLTOZATA: ugyanaz a megjelenés, de nem útvonalra visz, hanem egy ugyanazon az URL-en élő nézetből lép ki (az elszámolás-lapok
 * részlete a lista helyén áll, a „vissza" a kijelölést törli). Csak ott használd, ahol nincs cél-útvonal; ahol van, az `PilotBackLink`.
 */
export function PilotBackButton({
  onClick,
  children,
  flush = false,
}: {
  onClick: () => void;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${flush ? PILOT_BACK_LINK_FLUSH_CLASSES : PILOT_BACK_LINK_CLASSES} cursor-pointer`}
    >
      <Icon name="chevron-left" size={12} />
      {children}
    </button>
  );
}

/** A felirat: „Vissza", ha az előző lapról jöttünk (a cél az a lap), különben a lista neve (a tartalék cél). */
export function backLinkLabel(
  back: { fromWithinApp: boolean },
  listName: string,
): string {
  return back.fromWithinApp ? "Vissza" : listName;
}
