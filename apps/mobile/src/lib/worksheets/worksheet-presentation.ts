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
 * A teszt-fordítás (`tsconfig.test.json`) NEM ismeri az `@/` útvonal-rövidítést,
 * és a fájl maga megmondja, miért nem érdemes egy `paths` sorral "megjavítani".
 * (Itt korábban az is állt, hogy a fordítás kézzel karbantartott listán megy: az
 * a #207 óta NEM igaz, a lista helyén minta áll. A rövidítés hiánya viszont
 * változatlanul áll, és az alábbi következmény ezen múlik, nem a listán.)
 * Ha ez a fájl az API-modul típusait
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
  /** `null`, ha a lap hibajegy nelkul keletkezett -- lasd a sor indokat lent. */
  serviceJob: { jobNumber: string } | null;
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
 * kimondott hiányt, amik nem itt keletkeznek, ÉS a hibajegyet, ami itt igen.
 *
 * A HIBAJEGY SORA MINDIG OTT ÁLL, akkor is, ha nincs mögötte jegy, és ez az
 * egyetlen kivétel a fenti szabály alól ebben a függvényben. Az indok
 * ugyanaz, mint a webes lapon: a hiány itt nem kitöltetlen mező, hanem a
 * folyamat egyik rendes állapota -- és van következménye, mert hibajegy
 * nélkül a lapot nem lehet lezárni. Aki csak azt látja, hogy a lezárás nem
 * megy, nem tudja meg, mi hiányzik hozzá.
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

  /**
   * A SOR NEM `if` MOGOTT ALL: a hiany is allitas. A szoveg a webes lape
   * (`worksheet-detail-page.tsx`), hogy ugyanarrol a lapról az irodaban es a
   * helyszinen ugyanaz a mondat hangozzon el.
   *
   * A telefonon a szam CSAK SZOVEG, nem hivatkozas: hibajegy-keperno ma nincs
   * a mobil alkalmazasban, es egy megnyomhatonak latszo szam olyat igerne,
   * ami sehova nem visz.
   */
  rows.push({
    label: "Hibajegy",
    value: clean(worksheet.serviceJob?.jobNumber) || "Nincs mögötte hibajegy",
  });

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

/**
 * AZ ÁLLAPOT-SZŰRŐ VÁLASZTHATÓ ÉRTÉKEI, sorrendben.
 *
 * A „Mind" ELSŐ, és nem véletlenül: a szűrő alaphelyzete az, hogy nem szűr.
 * A sorrend a munka menetét követi (piszkozat, aláírásra vár, aláírva,
 * elutasítva), mert a szerelő ebben a sorrendben gondol rájuk.
 *
 * A NEVEK A SZERVER MAI ÁLLAPOTAI, ugyanazokkal a szavakkal, mint a weben. A
 * munka menete szerinti elnevezés (Új, Folyamatban, Elkészült, Lezárva) még nem
 * dőlt el, és amíg nem, addig egy saját szóhasználat a telefonon csak annyit
 * érne el, hogy az iroda és a helyszín mást mond ugyanarra a lapra.
 */
export const WORKSHEET_STATUS_FILTERS: readonly {
  value: WorksheetStatus | null;
  label: string;
}[] = [
  { value: null, label: "Mind" },
  { value: "DRAFT", label: worksheetStatusLabel.DRAFT },
  {
    value: "AWAITING_SIGNATURE",
    label: worksheetStatusLabel.AWAITING_SIGNATURE,
  },
  { value: "SIGNED", label: worksheetStatusLabel.SIGNED },
  { value: "REJECTED", label: worksheetStatusLabel.REJECTED },
];

/**
 * MIT MUTAT ÉPPEN A LISTA -- egy mondatban, a szűrők fölött.
 *
 * HÁROM SZŰRŐ VAN (saját lapok, partner, állapot), és mindegyik SZŰKÍT. Ha
 * mindhárom állását külön kell leolvasni három vezérlőről, akkor egy üres lista
 * elől a szerelő nem tudja megmondani, hogy nincs ilyen lap, vagy csak túl
 * szűkre állította magának. Ezért a lista maga mondja meg, MELYIK halmazt
 * mutatja -- ugyanaz a szabály, ami miatt a „Csak az enyém" kapcsoló is kiírja
 * az állását.
 */
export function worksheetFilterSummary(input: {
  mineOnly: boolean;
  partnerName?: string | null;
  status?: WorksheetStatus | null;
  search?: string;
}): string {
  const parts: string[] = [];
  parts.push(input.mineOnly ? "Rád kiosztva" : "Minden munkalap");
  const partner = input.partnerName?.trim();
  if (partner) parts.push(partner);
  if (input.status) parts.push(worksheetStatusLabel[input.status]);
  const search = input.search?.trim();
  if (search) parts.push(`„${search}" keresésre`);
  return parts.join(" · ");
}
