/**
 * RELATIV UT, NEM `@/` ALIAS -- es ezt a teszt-konfig fejlece koveteli meg.
 *
 * A `tsconfig.test.json` SZANDEKOSAN nem hordoz `paths` bejegyzest: a `tsc` a
 * kibocsatott specifikatort nem irja at, tehat a leforditott kodban maradna a
 * `@/...` alak, es a FUTAS hasalna el rajta. Ez a modul spec-bol behuzodik,
 * tehat relativ testver-utat kell irnia.
 */
import { WAITING_STATUSES } from "./list-card";
import type { ServiceJobListItem } from "./types";

/**
 * A HIBAJEGY-LISTA NEGY SZUROJE A TELEFONON.
 *
 * Balazs kerese (2026-09-17): "a mobil appban a hibajegyeknel ha elkeszult
 * statuszra valtunk eltunik a listabol. en szurni szeretnem: osszes, nyitott,
 * lezart, ram kiosztva es az osszes legyen az alapertelmezett".
 *
 * MIERT TUNT EL EDDIG: a kepernyo FIXEN `open` hatokort kert, a szerver pedig
 * arra a ket vegallapotot kiszuri. Nem hiba volt, hanem szandekos szukites --
 * a kepernyo fejlece ki is mondta. Most mas a keres.
 *
 * A SZURES A SZERVEREN TORTENIK, NEM ITT. A lista a szerveren vagodik
 * (kettoszaz sor, plusz egy `truncated` jelzes), tehat egy kliens-oldali szuro
 * csendben kevesebbet mutatna, mint amit a felirata iger.
 */
export type ServiceJobScope = "all" | "open" | "waiting" | "closed" | "mine";

/** What the server is asked for. "Várakozik" is the open list, narrowed. */
export type ServiceJobServerScope = "all" | "open" | "closed" | "mine";

export interface ServiceJobScopeOption {
  id: ServiceJobScope;
  label: string;
  /**
   * MUKODIK-E MENTETT MASOLATBOL.
   *
   * A masolat sorai `ServiceJobListItem` alakuak: az ALLAPOT rajtuk van, a
   * KIOSZTAS nincs. A `ram kiosztva` tehat terero nelkul nem szamolhato ki --
   * es ezt KIMONDJUK, nem a teljes listat adjuk helyette. Egy lista, ami
   * tagabb, mint a felirata, ugyanolyan hazugsag, mint az, ami szukebb.
   */
  offline: boolean;
}

/**
 * THE ORDER AND THE "VÁRAKOZIK" FILTER OF THE SERVICE REDESIGN (Figma
 * 423:876, 2026-10-04): Nyitott, Várakozik, Lezárt, Összes, and "Rám
 * kiosztva", which the design does not draw but which stays (decision 5).
 * The default is still "Összes" (Balázs, 2026-09-17).
 *
 * "Rám kiosztva" works from the saved copy too when every saved row carries
 * its assignees (`cachedItemsForScope`); `offline: false` says it may not.
 */
export const SERVICE_JOB_SCOPES: ServiceJobScopeOption[] = [
  { id: "open", label: "Nyitott", offline: true },
  { id: "waiting", label: "Várakozik", offline: true },
  { id: "closed", label: "Lezárt", offline: true },
  { id: "all", label: "Összes", offline: true },
  { id: "mine", label: "Rám kiosztva", offline: false },
];

/**
 * "VÁRAKOZIK" IS THE OPEN LIST, NARROWED ON THE PHONE. The server's open
 * scope holds the waiting statuses; the narrowing only drops rows of the
 * same answer, so the list is never wider than its label, and the server's
 * cut (`truncated`) still shows.
 */
export function serverScopeOf(scope: ServiceJobScope): ServiceJobServerScope {
  return scope === "waiting" ? "open" : scope;
}

/** The server's rows for a scope: only "Várakozik" narrows them further. */
export function itemsForScope(
  items: readonly ServiceJobListItem[],
  scope: ServiceJobScope,
): ServiceJobListItem[] {
  return scope === "waiting"
    ? items.filter((item) => WAITING_STATUSES.includes(item.status))
    : [...items];
}

/**
 * AZ ALAPERTELMEZES AZ OSSZES, ES A TELEFON KULDI KI MAGABOL.
 *
 * A szerver alapertelmezese `open` maradt: Balazs kerese a MOBIL alkalmazasra
 * szolt, es a szerveren atallitva a WEBES lista is elmozdulna, amirol senki nem
 * kert semmit.
 */
export const DEFAULT_SERVICE_JOB_SCOPE: ServiceJobScope = "all";

/** A ket vegallapot. Ugyanaz a ketto, amit a szerver `closed` hatokore ad. */
const FINISHED: ServiceJobListItem["status"][] = ["COMPLETED", "CANCELLED"];

export type CachedScopeResult =
  { kind: "items"; items: ServiceJobListItem[] } | { kind: "needs-connection" };

/**
 * A MENTETT MASOLAT EGY SZUROHOZ.
 *
 * KULON FUGGVENY, es tiszta: a telefon tesztsoraban nincs kepernyo-renderelo,
 * tehat a kepernyobe irva ez az agat semmi nem tudna merni.
 *
 * A MASOLAT MAGA IS RESZ (a szerver kettoszaz sornal vag, es csak az `osszes`
 * hatokor irja felul), ezert a felulet a sav mellett kimondja, hogy mentett
 * adatot mutat. Ez a fuggveny ezen belul dont: a KISZAMOLHATO szurest
 * elvegzi, a kiszamolhatatlant pedig megnevezi.
 */
export function cachedItemsForScope(
  items: readonly ServiceJobListItem[],
  scope: ServiceJobScope,
  userId?: string,
): CachedScopeResult {
  switch (scope) {
    case "all":
      return { kind: "items", items: [...items] };
    case "open":
      return {
        kind: "items",
        items: items.filter((item) => !FINISHED.includes(item.status)),
      };
    case "closed":
      return {
        kind: "items",
        items: items.filter((item) => FINISHED.includes(item.status)),
      };
    case "waiting":
      return {
        kind: "items",
        items: items.filter((item) => WAITING_STATUSES.includes(item.status)),
      };
    /**
     * "RÁM KIOSZTVA" FROM THE SAVED COPY, ONLY WHEN IT CAN BE TOLD (decision
     * 5, 2026-10-04). Rows saved since the phone reads assignees carry them;
     * older rows do not. If even one row lacks the field, the answer would be
     * a guess for that row, so the screen still says it needs a connection.
     */
    case "mine":
      if (
        userId === undefined ||
        items.some((item) => item.assignees === undefined)
      )
        return { kind: "needs-connection" };
      return {
        kind: "items",
        items: items.filter((item) =>
          item.assignees!.some((person) => person.userId === userId),
        ),
      };
  }
}
