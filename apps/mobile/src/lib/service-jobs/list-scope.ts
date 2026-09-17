/**
 * RELATIV UT, NEM `@/` ALIAS -- es ezt a teszt-konfig fejlece koveteli meg.
 *
 * A `tsconfig.test.json` SZANDEKOSAN nem hordoz `paths` bejegyzest: a `tsc` a
 * kibocsatott specifikatort nem irja at, tehat a leforditott kodban maradna a
 * `@/...` alak, es a FUTAS hasalna el rajta. Ez a modul spec-bol behuzodik,
 * tehat relativ testver-utat kell irnia.
 */
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
export type ServiceJobScope = "all" | "open" | "closed" | "mine";

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

export const SERVICE_JOB_SCOPES: ServiceJobScopeOption[] = [
  { id: "all", label: "Összes", offline: true },
  { id: "open", label: "Nyitott", offline: true },
  { id: "closed", label: "Lezárt", offline: true },
  { id: "mine", label: "Rám kiosztva", offline: false },
];

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
    /** A KIOSZTAS NINCS RAJTA A MENTETT SORON, tehat nem talalhato ki. */
    case "mine":
      return { kind: "needs-connection" };
  }
}
