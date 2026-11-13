import { helyszinFa } from "./helyszin-fa.js";

/**
 * AZ ÜZEMELTETÉSI NAPLÓ PARTNER-OLDALÁNAK TISZTA LOGIKÁJA (task os-uzemeltetesi-naplo, S5): a helyszín-választó sorai a fából és az
 * alapértelmezett hónap. Külön fájl, hogy a partner tesztépítés (DOM nélkül, `node --test`) mérni tudja.
 */
export interface SiteOption {
  id: string;
  /** A behúzott felirat a választóhoz: a mélység szerinti előtaggal. */
  label: string;
}

/**
 * A HELYSZÍN-LISTA LAPOSAN JÖN; a fát a közös `helyszinFa` építi (árva sor is megjelenik: a kiosztott helyszín szülője kimaradhat a
 * válaszból). A felirat a behúzás nyelvén az ág mélységét mutatja („— Nagy főmedence").
 */
export function siteOptions(
  items: readonly { id: string; parentId: string | null; name: string }[],
): SiteOption[] {
  return helyszinFa(items).map(({ item, depth }) => ({
    id: item.id,
    label: `${"— ".repeat(depth)}${item.name}`,
  }));
}

/** A hónap-választó alapértéke: az aktuális hónap `ÉÉÉÉ-HH` alakban. */
export function defaultMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Érvényes hónap-kulcs-e (a böngésző `month` mezője üres értéket is adhat, amíg a felhasználó nem fejezte be a választást). */
export function isMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
