// RELATÍV ÚT, NEM `@/`: a teszt-fordító nem ismeri az aliast
// (`tsconfig.test.json`-ban szándékosan nincs `paths`).
import type { UserRole } from "../auth/types";
import { atadasAllapota, MEG_NALUNK_VAN } from "./worksheet-handover";
import type { WorksheetLineKind } from "./worksheet-line-kind";

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
  /** A tetel fajtaja. Csak a `LABOR` visel munkaorat. */
  kind: WorksheetLineKind;
  /** Hanyan dolgoztak rajta. A szerver mindig kuldi, a hianya ott 1. */
  workerCount: number;
  /** A tetel munkaoraja, MAR KISZAMOLVA a szerveren. */
  laborHours: string;
}

export interface WorksheetDetailLike {
  customer: { displayName: string };
  department: { code: string; name: string };
  createdByName: string | null;
  /**
   * `null`, ha a lap hibajegy nelkul keletkezett -- lasd a sor indokat lent.
   *
   * AZ `id` 2026-09-21 OTA KELL, es nem csak kenyelembol: abbol lesz a
   * `serviceJobId` a soron, amivel a kepernyo atkattinthatova teszi. A mezot a
   * szerver EDDIG IS kuldte (`lib/api/worksheets.ts`), csak ez a szukebb,
   * sajat bemeneti tipus nem kerte.
   */
  serviceJob: { id: string; jobNumber: string } | null;
  /**
   * AZ ATADAS KET MEZOJE. `null`, amig nalunk van az eszkoz.
   *
   * A NEV KULON MEZO, NEM A DATUM RESZE: egy azota torolt kollega neve
   * eltunik (`onDelete: SetNull`), az atadas tenye nem.
   */
  handedOverAt: string | null;
  handedOverByName: string | null;
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
  /**
   * HA ALL, A SOR ATKATTINTHATO ERRE A HIBAJEGYRE.
   *
   * KONKRET NEV, NEM ALTALANOS `link`: pontosan EGY ilyen sor van, es egy
   * altalanos cel-mezo tobbet igerne, mint amit a fuggveny tud. A kepernyo
   * ebbol dönti el, hogy megnyomhatot rajzol-e -- es ha a mezo hianyzik, NEM
   * rajzol gombot.
   */
  serviceJobId?: string;
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
   * AZ ATADAS SORA MINDIG OTT ALL -- A MASODIK KIMONDOTT HIANY EBBEN A
   * FUGGVENYBEN, a hibajegy melle.
   *
   * Az indok ugyanaz: a hiany itt nem kitoltetlen mezo, hanem a lap eletenek
   * nagy resze. Es van kovetkezmenye: nalunk levo eszkoz mellett a hibajegy
   * nem zarhato le (Balazs dontese, 2026-09-21 09:39, "ne zarhassuk le amig
   * nalunk van"). Aki csak azt latja, hogy a lezaras nem megy, nem tudja meg,
   * mi hianyzik hozza.
   *
   * A MONDAT UGYANAZ, MINT A WEBEN. Ket felulet, egy allitas: ha csak az
   * egyik mondana ki, ugyanarrol a lapról ket kulonbozo kep alakulna ki az
   * irodaban es a helyszinen.
   */
  const atadas = atadasAllapota(worksheet);
  rows.push({
    label: "Átadás",
    value: atadas.atadva
      ? [formatWorksheetDate(atadas.mikor), clean(atadas.ki)]
          .filter(Boolean)
          .join(" · ")
      : MEG_NALUNK_VAN,
  });

  /**
   * A SOR NEM `if` MOGOTT ALL: a hiany is allitas. A szoveg a webes lape
   * (`worksheet-detail-page.tsx`), hogy ugyanarrol a lapról az irodaban es a
   * helyszinen ugyanaz a mondat hangozzon el.
   *
   * === A SZAM 2026-09-21 OTA ATKATTINTHATO, ES A REGI INDOKOT ATIRTAM ===
   *
   * KORABBAN EZ ALLT ITT: "a telefonon a szam CSAK SZOVEG, nem hivatkozas:
   * hibajegy-keperno ma nincs a mobil alkalmazasban, es egy megnyomhatonak
   * latszo szam olyat igerne, ami sehova nem visz."
   *
   * AZ ALLITAS IGAZ VOLT, AMIKOR MEGIRTAK (#480), es egy KESOBBI PR tette
   * hamissa: a #735 behozta a hibajegy-kepernyot
   * (`app/service-jobs/[id].tsx`). Semmi nem hibazott tole -- a sor tovabbra
   * is helyesen rajzolodott ki, csak mar folosleges volt szovegnek maradnia.
   *
   * A REGI INDOK VEDELME VISZONT ERVENYBEN MARAD, es ezert all a
   * `serviceJobId` CSAK akkor, ha van jegy: egy megnyomhatonak latszo szoveg,
   * ami sehova nem visz, rosszabb egy sima cimkenel.
   */
  const jegy = worksheet.serviceJob;
  rows.push({
    label: "Hibajegy",
    value: clean(jegy?.jobNumber) || "Nincs mögötte hibajegy",
    ...(jegy ? { serviceJobId: jegy.id } : {}),
  });

  return rows;
}

/**
 * EGY TÉTEL EGY SORBAN: mennyiség, egység, és munkaóránál a létszám.
 *
 * A BRUTTÓ ÖSSZEG 2026-09-17-ÉN KIKERÜLT INNEN. Balázs döntése ("B") szerint az
 * ár-mezők sehol nem jelennek meg, sem a weben, sem az appban.
 *
 * ÉS EZT A HELYET A SAJÁT MÉRÉSEM ELŐSZÖR KIHAGYTA: a felületi hatókört
 * `.tsx` fájlokra szűkítve mértem, ez pedig `.ts`. A fordító nevezte meg,
 * amikor a három képernyőről kivett formázó itt MÉG hívva maradt -- vagyis egy
 * árva import mutatott rá, nem a keresésem.
 *
 * A currency paraméter szándékosan MEGMARAD a szignatúrában: a hívók ma is
 * átadják.
 *
 * ÉS AZ INDOKA 2026-09-17 ESTE MEGDŐLT: azt írtam ide, hogy "a pénznem a
 * következő körben (munkaóra-felület) még kellhet". Az a kör megjött, és a
 * munkaóra NEM pénz -- a paraméterre semmi szükség nem lett. A mondat azért
 * áll itt javítva és nem törölve, mert a MEGTARTÁS indoka változott meg: ma
 * kizárólag az tartja bent, hogy a hívók átadják, és egy szűkítés az ő
 * átírásukat is jelentené.
 *
 * === A MUNKAÓRA CSAK AKKOR ÁLL KI KÜLÖN, HA MÁST MOND, MINT A MENNYISÉG ===
 *
 * Egy "1,5 óra · 1,5 munkaóra" sor ugyanazt a számot mondja kétszer. A
 * feltétel viszont NEM a képletre épül (hogy egy fő esetén a kettő egyenlő),
 * hanem a két ÉRTÉK összevetésére: ha a szerver képlete valaha változik, ez a
 * sor magától kiírja a különbséget, ahelyett hogy a mennyiséget mutatná
 * munkaóraként.
 */
export function worksheetLineSummary(
  line: WorksheetLineLike,
  _currency = "HUF",
): string {
  const mennyiseg = formatWorksheetQuantity(line.quantity);
  const darabok = [`${mennyiseg} ${clean(line.unit)}`.trim()];

  if (line.kind === "LABOR") {
    if (line.workerCount > 1) darabok.push(`${line.workerCount} fő`);
    const orak = formatWorksheetQuantity(line.laborHours);
    if (orak !== mennyiseg) darabok.push(`${orak} munkaóra`);
  }

  return darabok.filter(Boolean).join(" · ");
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

/**
 * MELYIK HALMAZZAL NYÍLJON A LISTA -- és miért nem a szerepkör dönti el.
 *
 * BALÁZS KÉRÉSE, 2026-09-17 (Discord, szó szerint): „a szűrésnél a minden
 * munkalap legyen az alapértelmezett". A kapcsoló megmarad, csak a kiindulási
 * állapota fordul: MINDEN szerepkörben a teljes halmaz jön elsőre.
 *
 * AMI ELŐTTE ÁLLT, ÉS MIÉRT NEM ÁLL TÖBBÉ: a képernyő `SERVICE` szerepkörben
 * a „Csak az enyém" halmazzal indult, azzal az indoklással, hogy a szerelőnek
 * alapból a saját lapjai kellenek. A telefont használó szerelő viszont épp azt
 * jelezte, hogy ez fordítva van: egy szűkebb kezdőhalmaz úgy néz ki, mintha
 * kevesebb munka lenne, és a másra kiosztott lapot senki nem keresi meg.
 *
 * EZÉRT KÜLÖN FÜGGVÉNY, HOLOTT MA KONSTANS: a képernyő törzsére nincs
 * komponens-teszt ebben az appban, tehát egy `useState(false)` visszaírását
 * SEMMI nem mérné. Így viszont egy állítás áll rajta, név szerint, és MIND A
 * HÉT szerepkörre lefut -- vagyis a szerepkör visszahozása pirosra vált.
 *
 * ÉS EZÉRT VESZ ÁT SZEREPKÖRT, HOLOTT NEM HASZNÁLJA. Paraméter nélkül a
 * hívás helye nem mondaná meg, hogy itt egy szerepkör-függő döntés SZŰNT MEG;
 * így a képernyőn látszik, mi az, amit szándékosan nem nézünk. A határa
 * kimondva: a függvény megkerülését (megint `useState(...)` a törzsben) ez sem
 * fogja meg -- azt ebben az appban semmi nem méri.
 */
export function worksheetListStartsMineOnly(
  _role: UserRole | undefined,
): boolean {
  return false;
}
