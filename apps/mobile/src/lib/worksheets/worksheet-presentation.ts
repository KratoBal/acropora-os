/**
 * Amit a munkalapról a TELEFONON látni kell, és ami hiányzik.
 *
 * Külön modul, mert az appban nincs komponens-teszt eszköz: ami a képernyő
 * törzsében marad, azt csak kézzel, telefonon lehet kipróbálni. A
 * `partner-presentation.ts` és az `asset-create.ts` ugyanezért készült így.
 *
 * KÉT KÜLÖNBÖZŐ HIÁNY VAN EZEN A LAPON, ÉS NEM UGYANAZ A KEZELÉSÜK.
 *
 * A partner adatlapján a hiányzó mező eltűnik: egy üres sor azt állítaná, hogy
 * tudunk róla valamit. A munkalapon viszont van két hiány, ami MAGA AZ
 * INFORMÁCIÓ, és ezért ki van mondva:
 *
 * - a piszkozatnak NINCS SZÁMA (a sorszám a lezáráskor keletkezik), és
 * - a lap lehet KIOSZTATLAN.
 *
 * Aki a helyszínen üres helyet lát a szám vagy a felelős helyén, hibát képzel
 * oda, és megkeresi az irodát. Aki azt olvassa, hogy „még nincs száma", az egy
 * szabályt lát, és dolgozik tovább.
 */

/**
 * A TÍPUSOK ITT SAJÁT, SZERKEZETI MÁSOLATOK, nem a `lib/api/worksheets`
 * modulból jönnek, és ez nem hanyagság.
 *
 * A teszt-fordítás (`tsconfig.test.json`) egy kézzel karbantartott listán megy,
 * és NEM ismeri az `@/` útvonal-rövidítést. Ha ez a fájl az API-modul típusait
 * importálná, a fordítás behúzná a `client.ts` fájlt is, azon keresztül az Expo
 * futásidejű modulokat -- és ez a spec nem fordulna le. A `partner-presentation.ts`
 * ugyanezért tart saját `PartnerLike` alakot.
 *
 * Amit az alakok kérnek, az MIND szerepel a szerver válaszában: a szerkezeti
 * illeszkedés miatt az API-objektumok minden további nélkül átadhatók.
 */
export type WorksheetStatus =
  "DRAFT" | "AWAITING_SIGNATURE" | "SIGNED" | "REJECTED";

export interface WorksheetListLike {
  number: string | null;
  label: string | null;
  customerName: string;
  departmentCode: string;
  status: WorksheetStatus;
  version: number;
  versionCount: number;
  assigneeNames: string[];
}

export interface WorksheetLineLike {
  quantity: string;
  unit: string;
  grossAmount: string;
}

export interface WorksheetDetailLike {
  customer: { displayName: string };
  department: { code: string; name: string };
  createdByName: string | null;
  currentVersion: {
    unitName: string | null;
    issueDate: string | null;
    fulfillmentDate: string | null;
    dueDate: string | null;
  };
}

export const worksheetStatusLabel: Record<WorksheetStatus, string> = {
  DRAFT: "Piszkozat",
  AWAITING_SIGNATURE: "Aláírásra vár",
  SIGNED: "Aláírva",
  REJECTED: "Elutasítva",
};

/**
 * UGYANAZ A SZÓHASZNÁLAT, MINT A WEBEN
 * (`apps/web/src/components/worksheets/worksheet-labels.ts`).
 *
 * Nem stílus: ugyanarról a lapról az irodában és a helyszínen ugyanazt a szót
 * kell hallani, különben egy telefonhívás fele arra megy el, hogy melyik
 * állapotról beszélünk. A két lista azért áll mégis két helyen, mert az Expo
 * app nem húzza be a munkatér csomagjait; az eltérésük néma volna, ezért ez a
 * fájl a webes szövegre hivatkozik, és a spec mind a négy állapotot rögzíti.
 */
export function worksheetLabelOrDraft(label: string | null): string {
  return label ?? "Még nincs száma";
}

/** Egy megjelenítendő sor: felirat és érték. Ami hiányzik, nem lesz sor. */
export interface WorksheetDetailRow {
  label: string;
  value: string;
}

function clean(value?: string | null): string {
  return value?.trim() ?? "";
}

const forintFormat = new Intl.NumberFormat("hu-HU", {
  style: "currency",
  currency: "HUF",
  maximumFractionDigits: 0,
});

/**
 * Az összegek SZÖVEGKÉNT jönnek az API-ból: a Decimal pontossága nem fér el
 * egy JavaScript számban. A megjelenítéshez számmá alakítjuk, de csak itt, és
 * ha az érték nem értelmezhető, inkább nyersen írjuk ki, mint hogy „NaN Ft"
 * jelenjen meg a szerelő kezében.
 */
export function formatWorksheetAmount(value: string, currency = "HUF"): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (currency === "HUF") return forintFormat.format(amount);
  return `${new Intl.NumberFormat("hu-HU").format(amount)} ${currency}`;
}

/**
 * A MENNYISÉG a tárolt alakjában hat tizedes (`2.000000`), és így is jön át.
 * Kiírva ez azt sugallná, hogy a pontosság jelent valamit; a szerelő két
 * darabot lát, nem kettő egész nullát. A tizedes viszont NEM vész el, ha van:
 * a `0.5` óra fél óra marad.
 */
export function formatWorksheetQuantity(value: string): string {
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return value;
  return new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 6 }).format(
    quantity,
  );
}

/** A dátum a szerverről ISO alakban jön; a lapon a nap kell, nem az óra. */
export function formatWorksheetDate(value: string | null): string {
  return clean(value).slice(0, 10);
}

/**
 * A FELELŐSÖK egy sorban. A KIOSZTATLAN lap ki van mondva: az üres hely azt
 * jelentené, hogy a lista nem tudta betölteni, holott a lap tényleg senkié.
 */
export function worksheetAssigneeLine(names: string[]): string {
  const named = names.map((name) => name.trim()).filter(Boolean);
  return named.length > 0 ? named.join(", ") : "Nincs kiosztva";
}

/**
 * A listasor MÁSODIK sora: kihez megy, és melyik helyszínre. A lap száma az
 * első sorban áll, ezért ide nem kerül vissza.
 */
export function worksheetListSubtitle(item: WorksheetListLike): string {
  return [clean(item.customerName), clean(item.departmentCode)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * HÁNYADIK VÁLTOZAT, ha egyáltalán van több.
 *
 * Egyetlen verziónál üres: a „1. verzió, összesen 1" felirat nem mond semmit,
 * viszont minden soron elvinne egy sort a képernyőből. Ahol viszont a lapot már
 * átírták, ott a szerelő kezében lévő papír lehet a RÉGI változat, és ezt csak
 * akkor veszi észre, ha látja, hogy van újabb.
 */
export function worksheetVersionNote(item: WorksheetListLike): string {
  if (item.versionCount <= 1) return "";
  return `${item.version}. változat, összesen ${item.versionCount}`;
}

/**
 * A lap fejadatai, sorokban. Ami hiányzik, NEM lesz sor -- kivéve a fenti két
 * kimondott hiányt, amik nem itt keletkeznek.
 */
export function worksheetDetailRows(
  worksheet: WorksheetDetailLike,
): WorksheetDetailRow[] {
  const rows: WorksheetDetailRow[] = [
    { label: "Partner", value: worksheet.customer.displayName },
  ];

  const unitName = clean(worksheet.currentVersion.unitName);
  const unitCode = clean(worksheet.department.code);
  const unit = [unitName || clean(worksheet.department.name), unitCode]
    .filter(Boolean)
    .join(" · ");
  if (unit) rows.push({ label: "Helyszín", value: unit });

  const issued = formatWorksheetDate(worksheet.currentVersion.issueDate);
  if (issued) rows.push({ label: "Kiállítva", value: issued });

  const fulfilled = formatWorksheetDate(
    worksheet.currentVersion.fulfillmentDate,
  );
  if (fulfilled) rows.push({ label: "Teljesítve", value: fulfilled });

  const due = formatWorksheetDate(worksheet.currentVersion.dueDate);
  if (due) rows.push({ label: "Fizetési határidő", value: due });

  const createdBy = clean(worksheet.createdByName);
  if (createdBy) rows.push({ label: "Felvette", value: createdBy });

  return rows;
}

/**
 * EGY TÉTEL EGY SORBAN: mennyiség, egység és a bruttó összeg.
 *
 * A nettó egységár szándékosan nincs benne. A szerelő azt magyarázza el a
 * helyszínen, amit a partner is lát az aláírandó lapon, és ott a tétel VÉGE a
 * kérdés. A bontás a webes lapon és a nyomtatott példányon megvan.
 */
export function worksheetLineSummary(
  line: WorksheetLineLike,
  currency = "HUF",
): string {
  return [
    `${formatWorksheetQuantity(line.quantity)} ${clean(line.unit)}`.trim(),
    formatWorksheetAmount(line.grossAmount, currency),
  ]
    .filter(Boolean)
    .join(" · ");
}
