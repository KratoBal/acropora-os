import type { WorksheetVersionStatus } from "@acropora/types";

/**
 * AZ ÁLLAPOT-FELIRATOK A `@acropora/types`-BÓL JÖNNEK, ÉS ITT CSAK ÁTMENNEK.
 *
 * 2026-09-21-ig ennek a fájlnak a törzsében álltak. A partnerportál ugyanezt a
 * négy állapotot írja ki, és az `apps/web` forrását nem éri el -- addig a
 * NYERS enum-érték látszott nála (`SIGNED`, `DRAFT`).
 *
 * A re-export marad, mert a modul többi címkéje (szín, összegformázás)
 * webes, tehát a hívóknak amúgy is innen kell importálniuk.
 */
export { worksheetStatusLabel } from "@acropora/types";

/**
 * AZ ALLAPOT MEGITELESE: jo, rossz, varakozo vagy semleges. EGY helyen.
 *
 * TABLAZAT, NEM FELTETEL-LANC, ES EZ A LENYEGE. A korabbi alak harom `if`-bol
 * allt es egy `return "neutral"`-lal zart -- vagyis egy UJ allapot CSENDBEN
 * semlegesnek latszott volna, es semmi nem szolt volna rola. Nem elmeleti
 * kockazat: a szerver DTO-ja maga mondja ki, hogy "amig a vitatott (ala nem
 * irt) lap sorsa nyitott, a lekepezes sem rogzitheto" -- tehat egy otodik
 * ertekkel SZAMOLUNK.
 *
 * `Record<WorksheetVersionStatus, ...>` alakban a fordito kenyszeriti ki a
 * teljesseget: egy uj allapot nem a felulten jelenik meg szurken, hanem a
 * forditasnal, nev szerint. A masik ket szerviz-szotar (`assetStatusTone`,
 * `JOB_STATUS_TONE`) mar igy all; ez a harmadik volt hatra.
 */
const WORKSHEET_STATUS_VARIANT: Record<
  WorksheetVersionStatus,
  "success" | "warning" | "danger" | "neutral"
> = {
  DRAFT: "neutral",
  AWAITING_SIGNATURE: "warning",
  SIGNED: "success",
  REJECTED: "danger",
};

export function worksheetStatusVariant(status: WorksheetVersionStatus) {
  return WORKSHEET_STATUS_VARIANT[status];
}

/**
 * A piszkozatnak nincs száma: a sorszám a lezáráskor keletkezik. A listán
 * ezért nem üres cella áll, hanem kimondjuk, hogy még nincs - üres helyre a
 * felhasználó hibát képzel, nem szabályt.
 */
export function worksheetLabelOrDraft(label: string | null): string {
  return label ?? "Még nincs száma";
}

const forintFormat = new Intl.NumberFormat("hu-HU", {
  style: "currency",
  currency: "HUF",
  maximumFractionDigits: 0,
});

/**
 * Az összegek szövegként jönnek az API-ból (a Decimal pontossága nem fér
 * el egy JavaScript számban). A megjelenítéshez számmá alakítjuk, de csak
 * itt, egyetlen helyen - és ha az érték nem értelmezhető, inkább kiírjuk
 * nyersen, mint hogy "NaN Ft" jelenjen meg a lapon.
 */
/**
 * A HIÁNYZÓ ÁR JELE, egy helyen. Nem üres cella: az üres hely a táblázatban
 * megkülönböztethetetlen egy elcsúszott oszloptól, és a nulla forint egy
 * elvégzett, ingyenes munkát jelentene.
 */
export const MISSING_AMOUNT = "—";

export function formatAmount(value: string | null, currency = "HUF"): string {
  // A `null` NEM formázási hiba, hanem a rendszer egy állapota: a helyszínen
  // rögzített tételen az árat az iroda adja meg később.
  if (value === null) return MISSING_AMOUNT;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (currency === "HUF") return forintFormat.format(amount);
  return `${new Intl.NumberFormat("hu-HU").format(amount)} ${currency}`;
}

/**
 * A PENZNEM ROVID JELE, egy helyen.
 *
 * A `formatAmount` mar tudja, hogy a HUF magyarul "Ft" -- ez a fuggveny
 * ugyanabbol a tudasbol adja a JELET, hogy a szerkeszto mezo melle is ki
 * lehessen irni anelkul, hogy a "HUF -> Ft" megfeleltetes MASODSZOR is le
 * lenne irva valahol. Ket helyen allo megfeleltetes elcsuszasa nema.
 */
export function currencySuffix(currency = "HUF"): string {
  return currency === "HUF" ? "Ft" : currency;
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10);
}

export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("hu-HU", {
    timeZone: "Europe/Budapest",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * A MUNKALAP-ALLAPOT SZINE ATKOLTOZOTT A `@acropora/types`-ba (2026-09-24,
 * a munkalap-lapok partneri paritasa) -- lasd ott a teljes indoklast. A
 * `worksheetStatusVariant` HELYBEN MARAD: csak ez a fuggveny hasznalja,
 * apps/web-fuggese nincs, athelyezese semmit nem nyerne.
 */
export { worksheetStatusTone } from "@acropora/types";

import { worksheetStatusTone } from "@acropora/types";
import type { PilotBadgeVariant } from "@/components/pilot/pilot-ui";

/**
 * A KANONIKUS `worksheetStatusTone` LEKÉPEZÉSE A PILOT BADGE PALETTÁJÁRA.
 *
 * Ugyanaz a minta, mint `assetStatusPilotVariant`
 * (`apps/web/src/components/service-assets/asset-labels.ts`) -- lásd ott a
 * teljes indoklást a `red`/`purple` ágak biztonságos visszaesésére.
 */
const TONE_TO_PILOT_VARIANT: Record<
  "neutral" | "purple" | "green" | "amber" | "red" | "blue",
  PilotBadgeVariant
> = {
  green: "teal",
  amber: "amber",
  blue: "blue",
  red: "danger",
  neutral: "grey",
  purple: "default",
};

export function worksheetStatusPilotVariant(
  status: WorksheetVersionStatus,
): PilotBadgeVariant {
  return TONE_TO_PILOT_VARIANT[worksheetStatusTone(status)];
}
