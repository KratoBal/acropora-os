import { readFileSync } from "node:fs";

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { Prisma } from "@acropora/database";

import { resolveMaintenanceOrderFormTemplatePath } from "./maintenance-order-form-template-path.js";

import {
  computeMaintenanceOrderFormItemAmounts,
  sumMaintenanceOrderFormAmounts,
} from "./maintenance-order-form-amounts.js";
import {
  formatOrderFormSummaryAmount,
  formatOrderFormTableAmount,
} from "./maintenance-order-form-formatting.js";
import type {
  MaintenanceOrderFormInput,
  MaintenanceOrderFormItem,
} from "./maintenance-order-form.types.js";

/**
 * A MEGRENDELŐLAP DOCX-KÉNT -- AZ ÜGYFÉL SAJÁT SABLONJÁNAK KITÖLTÖTT MÁSOLATA.
 *
 * Balázs döntése (2026-09-25 17:09 UTC, emlék 1849), szó szerint: "szerintem
 * akkor legyen a word, de ugyanugy nezzen ki mint amit feltoltottem." A
 * korábbi PDF-rajzoló (`maintenance-order-form-document.ts`, TÖRÖLVE ebben a
 * körben) a mintáról MÁSOLTA a szöveget és rajzolta újra -- ez a modul
 * helyette a mintát MAGÁT tölti ki, `docxtemplater`-rel, tehát a betűk, a
 * táblázat, a keret és az ügyfél fejléce SZERKEZETILEG ugyanaz marad, amit
 * feltöltött.
 *
 * === A SABLON KÉT PÉLDÁNYBAN ÁLL, A CSOMAG GYÖKERÉN, NEM A `src/` ALATT ===
 *
 * `apps/api/assets/megrendelolap/` -- a `assets/fonts/` (lásd
 * `documents/pdf/pdf-font.ts`) TESTVÉR mappája, ugyanazért: a fordító a
 * `src/**\/*.ts`-en kívüli fájlokat nem másolja a `dist`/`test-dist` mellé,
 * tehát a sablonnak a CSOMAG gyökeréhez képest kell élnie, nem a forrás
 * mellett -- az útvonalat a `maintenance-order-form-template-path.ts`
 * FELFELÉ KERESVE találja meg, ugyanúgy, ahogy a PDF-betű is.
 *
 * `megrendelolap-minta-forras.docx` -- Balázs EREDETI, változatlan feltöltése
 * (`exchange/minta-megrendelolap-allatkert.docx`), csak DOKUMENTÁCIÓNAK: soha
 * nem tölti be ez a modul, nem fut rajta semmi.
 *
 * `megrendelolap-sablon.docx` -- ugyanaz a fájl, `{tag}` jelölőkkel a
 * KITÖLTENDŐ mezők helyén (a formázás, a táblázat kerete, a betűk
 * VÁLTOZATLANOK -- csak a mintában szereplő PÉLDA-ÉRTÉKEK futása lett egy-egy
 * jelölővé vonva össze). EZT tölti be és tölti ki a `render()`.
 *
 * A jelölőket kézzel, az XML-en dolgozva helyeztem el (nem Word-ben gépelve),
 * mert a minta VALÓDI, kitöltött példány volt (a Fővárosi Állat- és
 * Növénykert 2026-os SZ2026/0000019 szerződéséből), nem üres űrlap -- a
 * jelölés tehát a PÉLDA-ÉRTÉKEK lecserélése volt, nem üres helyek kitöltése.
 *
 * === A TÉTEL-TÁBLÁZAT: `{#items}`/`{/items}` SOR-CIKLUS, INGYENES ===
 *
 * A `docxtemplater` "loop in tables to generate columns/rows" funkciója a
 * CSOMAG SAJÁT, MIT-licencű magja (nem a fizetős "Table Module", ami egy
 * MÁSIK, kétdimenziós adatból táblát ÉPÍTŐ funkció, `{:table data}`
 * szintaxissal) -- lásd a csomag saját `README.md`-jét és `LICENSE.md`-jét
 * (`node_modules/.pnpm/docxtemplater@.../node_modules/docxtemplater/`): a
 * "Use loops in tables to generate columns" a Features listában áll, NEM a
 * "Modules" (fizetős) listában. A minta táblázatának EGYETLEN tétel-sorát
 * hagytam meg jelölőkkel (a `{#items}` az első cella elején, a `{/items}` az
 * utolsó cella végén ugyanabban a sorban) -- a másik három PÉLDA-sort (5, 6,
 * 7 tételszámmal) a sablonból KITÖRÖLTEM, mert a ciklus ezt a MEGMARADT sort
 * ismétli tételenként.
 *
 * === HÁROM MEZŐ, AMI A MAI MINTÁN NINCS SEHOL -- NEM TALÁLTAM KI HELYET ===
 *
 * Mérve az `exchange/minta-megrendelolap-allatkert.docx` teljes szövegén
 * (a `word/document.xml` minden `<w:t>` eleme): a "Megrendelőlap sorszáma"
 * felirat és a "Kelt: Budapest, ..." dátumsor EGYETLEN HELYEN sem szerepel a
 * mintán -- a korábbi PDF ezt saját döntésből ADTA HOZZÁ a laphoz, a minta
 * fizikai alakja nem tartalmazza. Mivel a feladat kifejezetten a minta
 * PONTOS alakját kéri, ez a két mező NEM kerül a docx-be -- a megrendelőlap
 * SAJÁT sorszáma ezután csak a fájlnévben látszik
 * (`megrendelolap-<szám>.docx`), a nyomtatott lapon nem. Lásd a PR törzsét.
 *
 * A HARMADIK: "A megrendelés tárgya" felirat UTÁN a mintán ÁLLANDÓ, nem
 * példa-szöveg áll ("Vízgépészet és akvarisztikai berendezések karbantartása
 * /javítása") -- ez a szolgáltatás-kategória megnevezése a nyomtatványon,
 * nem az adott megrendelés tárgya. Ezt a szöveget ÉRINTETLENÜL hagytam
 * (nincs `{subject}` jelölő a sablonban): az `input.subject`/`DEFAULT_SUBJECT`
 * mező innentől a docx-en nem jelenik meg, mert a mintán nincs neki elkülönített,
 * kitöltendő helye -- a beírása felülírná az ügyfél saját, állandó szövegét.
 *
 * === EGY TIPOGRÁFIAI EGYSZERŰSÍTÉS ===
 *
 * A mintán a "Raktárral egyeztetve: IGEN / NEM" sorban a VÁLASZ aláhúzással
 * van jelölve (a mintában épp "NEM" volt aláhúzva). Egyetlen `{warehouseText}`
 * jelölő váltja fel a teljes "IGEN / NEM" szakaszt, sima szöveggel (a
 * `warehouseText()` a PDF korábbi logikáját követi: csak a valódi választ írja
 * ki, vagy mindkettőt "IGEN / NEM" alakban, ha nem ismert) -- az aláhúzásos
 * kiemelés emiatt elmarad. Kis, vizuális egyszerűsítés, nem tartalmi hiba.
 */

const TEMPLATE_PATH = resolveMaintenanceOrderFormTemplatePath();

function ownBudgetMarks(ownBudgetSource: boolean | undefined): {
  ownBudgetYesMark: string;
  ownBudgetNoMark: string;
} {
  const ownBudget = ownBudgetSource ?? true;
  return {
    ownBudgetYesMark: ownBudget ? "X" : "",
    ownBudgetNoMark: ownBudget ? "□" : "X",
  };
}

function warehouseText(
  warehouseCoordinated: boolean | null | undefined,
): string {
  if (warehouseCoordinated === true) return "IGEN";
  if (warehouseCoordinated === false) return "NEM";
  return "IGEN  /  NEM";
}

interface TemplateItem {
  position: string;
  description: string;
  unitPrice: string;
  quantity: string;
  occasions: string;
  total: string;
}

function itemToTemplateValues(item: MaintenanceOrderFormItem): TemplateItem {
  const amounts = computeMaintenanceOrderFormItemAmounts(item);
  return {
    position: String(item.position),
    description: item.description,
    unitPrice: formatOrderFormTableAmount(
      new Prisma.Decimal(item.unitPricePerOccasion),
    ),
    quantity: String(item.quantity),
    occasions: String(item.occasionsPerYear),
    total: formatOrderFormTableAmount(amounts.netAmount),
  };
}

/**
 * A DOCXTEMPLATER `undefined`-RE HIBÁT DOB, HA NEM ADUNK `nullGetter`-T --
 * az OPCIONÁLIS mezők (lásd a `.types.ts` fejlécét: szervezeti egység,
 * terhelendő kód, ügyintéző stb.) a mai adatmodellben gyakran hiányoznak, és
 * a minta ÜRES alakja pontosan ezt az esetet szolgálja ki -- egy hiányzó
 * jelölő tehát ÜRES SZÖVEGGÉ oldódik, nem dobott hibává. Az EGYETLEN kivétel
 * az "Iktatási száma" -- lásd `REGISTRATION_NUMBER_BLANK` lejjebb.
 */
function nullGetter(): string {
  return "";
}

/**
 * AZ "IKTATÁSI SZÁMA" MEZŐ ÜRES ÁLLAPOTA A MINTÁN NEM ÜRES, HANEM PONTOZOTT
 * VONAL -- a `.types.ts` `registrationNumber` mező fejléce is ezt írja le
 * ("üresen, pontozott vonalként megy ki, hogy kézzel kitölthető legyen"):
 * ez az ÜGYFÉL saját iktatószáma, amit jellemzően ők írnak rá kézzel, amikor
 * a lapot kézhez veszik. A sablonban lévő EREDETI pontsor (14 karakter, hét
 * futásra darabolva -- lásd a modul fejlécét a jelölés módjáról), szó
 * szerint átvéve: ha ezt üres string váltaná, a nyomtatott lapon egy csupasz
 * "Iktatási száma:" sor állna, félrevezetve azt, aki kitöltésre keresné a
 * helyet.
 */
const REGISTRATION_NUMBER_BLANK = "…….………....…………";

export interface RenderedMaintenanceOrderForm {
  content: Buffer;
  /** A táblázatba írt tételek száma -- a hívó ezzel ellenőrizheti a
   * generálás eredményét saját bemenete ellen, adatbázis-írás előtt. */
  itemCount: number;
}

/**
 * A MEGRENDELŐLAP BEMENETÉBŐL DOCX-BÁJTOK -- TISZTA FÜGGVÉNY.
 *
 * Szinkron a `docxtemplater`-en belül (nincs I/O a `render()` hívásban), de a
 * függvény async, mert a sablon-fájl olvasása I/O -- ugyanaz a szerződés,
 * mint a korábbi `renderMaintenanceOrderFormPdf`-é (Promise<Buffer>), hogy a
 * hívó oldalon (`maintenance-orders.service.ts`) ne kelljen az `await`-en túl
 * mást módosítani.
 */
export async function renderMaintenanceOrderFormDocx(
  input: MaintenanceOrderFormInput,
): Promise<RenderedMaintenanceOrderForm> {
  const templateBytes = readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(templateBytes);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter,
  });

  const amounts = input.items.map((item) =>
    computeMaintenanceOrderFormItemAmounts(item),
  );
  const total = sumMaintenanceOrderFormAmounts(amounts);

  const marks = ownBudgetMarks(input.ownBudgetSource);

  doc.render({
    customerName: input.customer.name,
    customerAddress: input.customer.address,
    registrationNumber:
      input.customer.registrationNumber ?? REGISTRATION_NUMBER_BLANK,
    organizationalUnitName: input.customer.organizationalUnitName ?? "",
    chargeCode: input.customer.chargeCode ?? "",
    inventoryZoneCode: input.customer.inventoryZoneCode ?? "",
    contactPersonName: input.customer.contactPersonName ?? "",
    contractNumber: input.contractNumber,
    ownBudgetYesMark: marks.ownBudgetYesMark,
    ownBudgetNoMark: marks.ownBudgetNoMark,
    warehouseText: warehouseText(input.warehouseCoordinated),
    grossAmount: formatOrderFormSummaryAmount(total.grossAmount),
    netAmount: formatOrderFormSummaryAmount(total.netAmount),
    vatAmount: formatOrderFormSummaryAmount(total.vatAmount),
    tableTotal: formatOrderFormTableAmount(total.netAmount),
    items: input.items.map(itemToTemplateValues),
  });

  const content = doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
  const itemCount = countTemplateRows(doc.getZip());
  return { content, itemCount };
}

/**
 * A KIMENETI XML-BŐL SZÁMOLT SORSZÁM, NEM A BEMENET VISSZHANGJA.
 *
 * Ha `itemCount`-ot egyszerűen `input.items.length`-ből adnánk vissza, az
 * ÖNMAGÁBAN SOHA nem tudna eltérni -- semmit nem mérne a docxtemplater
 * tényleges kimenetéről, csak a saját bemenetét ismételné. Ehelyett a
 * TÁBLÁZAT tényleges sorainak számát olvassuk vissza a legenerált
 * `word/document.xml`-ből: a sablon egy fejléc- és egy összesítő-sort visel
 * a ciklus KÖRÜL (lásd a modul fejlécét), tehát a tétel-sorok száma a teljes
 * `<w:tr` darabszám mínusz kettő -- ha a ciklus valamiért nem a várt
 * darabszámot generálta, ez az érték eltér `input.items.length`-től, és a
 * hívó (`maintenance-orders.service.ts`) ezt hibaként kezeli.
 */
function countTemplateRows(zip: PizZip): number {
  const documentXml = zip.files["word/document.xml"]?.asText() ?? "";
  const rowCount = (documentXml.match(/<w:tr[ >]/g) ?? []).length;
  return Math.max(0, rowCount - 2);
}
