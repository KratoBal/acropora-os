/**
 * A CÁPASULI PISZKOZATOK MEGJELENÍTÉSE A TELEFONON (kártya 49210cdd).
 *
 * Tiszta függvények, hogy a teszt-fordítás is lássa őket: ez a fájl nem
 * importál `@/` aliast és Expo futásidőt (lásd `push-target.ts` fejléce).
 */
import type { AcceptServiceDraftInput, ServiceDraftListItem } from "./types";

/**
 * KI LÁTJA A PISZKOZATOKAT: ugyanaz a szabály, mint a szerver
 * `requireDraftAdmin`-ja (`apps/api/src/service-drafts/service-drafts.service.ts`):
 * belső tulajdonos vagy adminisztrátor, partner- és beszállító-kötés nélkül.
 * A szerver dönt; ez csak azt kerüli el, hogy a képernyő egy biztos 403-at
 * kérjen le, és hibaként mutassa.
 */
export function canReviewServiceDrafts(
  user: {
    role: string;
    customerId?: string | null;
    supplierId?: string | null;
  } | null,
): boolean {
  return (
    !!user &&
    (user.role === "OWNER" || user.role === "ADMIN") &&
    !user.customerId &&
    !user.supplierId
  );
}

/**
 * A JEV-SZŰRÉS JELE: ugyanaz a szabály, mint a webes kártyán
 * (`draftFilterBadge`, `apps/web/src/components/service-drafts`). A „Nem
 * szűrt” csak bekapcsolt szűrésnél mond valamit: kikapcsolva minden tétel az.
 */
export function draftFilterLabel(
  item: Pick<ServiceDraftListItem, "filterState">,
  filterEnabled: boolean,
): string | null {
  if (item.filterState === "UNCERTAIN") return "Bizonytalan";
  if (item.filterState === "PROMOTED") return "Kiszűrtből visszahozva";
  if (item.filterState === "UNFILTERED" && filterEnabled) return "Nem szűrt";
  return null;
}

/** A kártya meta-sora: „2026-10-06 · Kiss Anna · 2. alkalom · 1 melléklet”. */
export function draftMetaLine(
  item: Pick<
    ServiceDraftListItem,
    "reportDate" | "reporterPersonName" | "occurrence" | "attachments"
  >,
): string {
  const parts = [item.reportDate];
  const reporter = item.reporterPersonName?.trim();
  if (reporter) parts.push(reporter);
  if (item.occurrence > 1) parts.push(`${item.occurrence}. alkalom`);
  if (item.attachments.length > 0)
    parts.push(`${item.attachments.length} melléklet`);
  return parts.join(" · ");
}

/**
 * MIÉRT NEM FOGADHATÓ EL MOST (vagy `null`, ha elfogadható). Ugyanaz a két
 * feltétel, mint a weben: helyszín nélkül nincs hova nyitni a jegyet, és a
 * hibajegy nyitója (a Cápasuli partnerfelhasználója) nélkül a szerver úgyis
 * elutasítaná. A szöveg a gomb alatt áll: egy szürke gomb ok nélkül
 * elromlottnak látszik.
 */
export function acceptBlocker(
  departmentId: string,
  openedBy: { id: string } | null,
): string | null {
  if (!openedBy)
    return "Elfogadni csak a Cápasuli helyszínének és partnerfelhasználójának beállítása után lehet (weben). Elvetni addig is lehet.";
  if (!departmentId) return "Válassz helyszínt az elfogadáshoz.";
  return null;
}

/** Az elfogadás törzse: a szerző levágva, legfeljebb 200 jel, üresen `null`. */
export function acceptInput(
  departmentId: string,
  reporterPersonName: string,
): AcceptServiceDraftInput {
  const name = reporterPersonName.trim().slice(0, 200);
  return { departmentId, reporterPersonName: name || null };
}
