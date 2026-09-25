/**
 * A MEGRENDELŐLAP A PARTNER PORTÁLON -- KÜLÖN, SZŰKEBB ALAK, NEM A BELSŐ
 * `MaintenanceOrder` MÁSOLATA.
 *
 * A belső, `PARTNERS_MANAGE`-es válasz (`apps/api/src/maintenance-orders`)
 * árat hordoz (`MaintenanceOrderItem.unitNet`/`vatRatePercent`) -- ez a
 * portál felé SOHA nem mehet ki, ugyanúgy, ahogy a szerződés tételei sem
 * (acrobot jóváhagyása, msg_id 23868, 2026-09-25 22:17 UTC). Ezért a portál
 * saját típust és saját, szűk szervermezőt kap, nem a belső válasz egy
 * részhalmazát a kliens oldalon elrejtve -- egy elrejtett mező bármikor
 * visszakerülhet, egy nem is létező mező nem.
 */
export type MaintenanceOrderStatusValue = "ISSUED" | "SIGNED" | "REVOKED";

export const maintenanceOrderStatusLabel: Record<
  MaintenanceOrderStatusValue,
  string
> = {
  ISSUED: "Kiállítva",
  SIGNED: "Aláírva",
  REVOKED: "Visszavonva",
};

/**
 * A SZÍNEK A FIGMA TERV `orderBadge()` FÜGGVÉNYÉT KÖVETIK
 * (`PartnerPortalScreen.tsx`): Kiállítva -> amber, Aláírva -> zöld,
 * Visszavonva -> piros. A `ServiceTone` hatértékű készletéből dolgozunk,
 * ugyanúgy, mint a `worksheetStatusTone`/`assetStatusTone`.
 */
export type MaintenanceOrderStatusTone = "amber" | "green" | "red";

export const maintenanceOrderStatusTone: Record<
  MaintenanceOrderStatusValue,
  MaintenanceOrderStatusTone
> = {
  ISSUED: "amber",
  SIGNED: "green",
  REVOKED: "red",
};

/**
 * A KÉT LEHETSÉGES TARTALOMTÍPUS, NEM ÁLTALÁNOS `string`.
 *
 * A `GENERATED_FORM` MA `.docx` (a mai nap `feat/maintenance-order-form-
 * docx` munkája óta, lásd `MaintenanceOrdersService.issue()`), a
 * `SIGNED_FORM` mindig a feltöltéskor ellenőrzött, valódi PDF (lásd
 * `uploadSignedDocument()` PDF-aláírás-ellenőrzését). A portál letöltő
 * gombja ebből dönti el a fájl kiterjesztését és ikonját -- NEM feltételezi
 * egyik formátumot sem előre, mert a Figma terv PDF-et mutat, ami mára
 * elavult.
 */
export type MaintenanceOrderDocumentContentType =
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/pdf";

export interface MaintenanceOrderDocumentSummary {
  id: string;
  type: "GENERATED_FORM" | "SIGNED_FORM";
  fileName: string;
  contentType: MaintenanceOrderDocumentContentType;
  sizeBytes: number;
  createdAt: string;
}

/** Egy tétel, ár nélkül. A `#` (sorszám) a szerződés tételének pozíciója. */
export interface MaintenanceOrderPartnerItem {
  id: string;
  position: number;
  description: string;
  /**
   * DECIMAL, STRING ALAKBAN -- ugyanaz a minta, mint a
   * `WorksheetLineDetail.quantity`-nél.
   */
  quantity: string;
  /**
   * MINDIG "alkalom" -- a modellen nincs önálló mértékegység-mező, és a
   * szolgáltatás-réteg is ezt a szót írja a generált dokumentumba (lásd
   * `MaintenanceOrdersService.issue()`, `occasionsPerYear: 1` megjegyzése):
   * egy megrendelőlap-tétel egy alkalmat visz. Ez tehát nem kitalált érték,
   * a kódbázis már meglévő konvenciója.
   */
  unit: "alkalom";
}

export interface MaintenanceOrderPartnerSummary {
  id: string;
  number: string;
  contractNumber: string;
  contractTitle: string;
  status: MaintenanceOrderStatusValue;
  /**
   * A KIÁLLÍTÁS HÓNAPJA ÉS ÉVE, MAGYARUL ("2026. október") -- a Figma terv
   * "Időszak" oszlopa hónap-pontosságú mintát mutat (`idoszak: '2026. okt.'`),
   * a modellen viszont nincs külön időszak-mező, csak `issuedAt` (pontos
   * dátum) és `occasionYear` (év). Ez a mező tehát `issuedAt`-ből SZÁRMAZTATOTT
   * kijelzési érték, nem tárolt adat.
   */
  period: string;
  /**
   * A HELYSZÍN OSZLOP -- lásd `maintenance-order-visibility.ts` fejlécét a
   * pontos szabályért. `null`, ha az order egyetlen tételéhez sincs
   * helyszín rendelve (ez a mai kiállítási szabály mellett -- lásd
   * `MaintenanceOrdersService.issue()` `helyszinNelkul` ellenőrzését --
   * gyakorlatilag elő sem fordulhat, de a típus a jövőre nézve is helyes
   * marad).
   */
  departmentName: string | null;
  issuedAt: string;
}

export interface MaintenanceOrderPartnerListResponse {
  items: MaintenanceOrderPartnerSummary[];
}

export interface MaintenanceOrderPartnerDetail extends MaintenanceOrderPartnerSummary {
  items: MaintenanceOrderPartnerItem[];
  documents: MaintenanceOrderDocumentSummary[];
  /**
   * VAN-E BEJELÖLVE A HÍVÓNÁL AZ ALÁÍRT PÉLDÁNY FELTÖLTÉSÉNEK KÉPESSÉGE --
   * ugyanaz a minta, mint az `AquariumDetail.canAssignAssets`-nél: minden
   * válaszon rajta van, nem csak a feltöltés próbálkozásakor derül ki, hogy
   * hiányzik.
   */
  canUploadSigned: boolean;
}
