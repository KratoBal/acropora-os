import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ASSET_DOCUMENT_TYPES } from "../auth/partner-scope.util.js";

/**
 * A DOKUMENTUM-FAJTAK LISTAJA NEGY HELYEN ALL, ES MOSTANTOL EGYUTT IS MOZOG.
 *
 * === MIERT SZULETETT, ES EZ MERT ESET, NEM FELTEVES ===
 *
 * 2026-09-22-en felvettuk a PHOTO fajtat. A felvetel elott megmertem, hany
 * helyen all ugyanaz a lista, es hany allitas koti oket ossze: NEGY hely, NULLA
 * allitas. Az atvezetes soran a fordito ebbol KETTOT fogott meg (a kliens-oldali
 * tipust es a webes feliratot), a masik kettorol semmi nem szolt.
 *
 * A NEMA FELE A DRAGABB, ES NEV SZERINT EZ A KETTO:
 *
 *   a MOBIL masolata   a pnpm workspace-en KIVUL all, tehat a fordito a ket
 *                      oldalt soha nem veti ossze. Egy kimaradt ertek nem
 *                      hibazik: a telefonon a nyers enum-nev jelenne meg, vagy
 *                      egy `undefined` felirat -- hibauzenet nelkul.
 *   a SEMA             az egyetlen forras, ami az adatbazisban ERVENYES. Ha a
 *                      kod ismer egy fajtat, amit a sema nem, az iras futasidoben
 *                      hal el, nem forditaskor.
 *
 * === ES AMIT EZ A KESZLET NEM VED ===
 *
 * Nem veszi at a fordito munkajat, es nem is arra valo. Azt allitja, hogy a NEGY
 * HALMAZ UGYANAZ -- tehat a szetcsuszas lathato lepes lesz, nem csendes.
 *
 * Ha egyszer SZANDEKOS elteres keletkezik (peldaul egy belsos-only fajta, amit a
 * mobil nem ismer), akkor a helyes lepes NEM ennek a keszletnek a kikapcsolasa,
 * hanem egy NEVESITETT kivetel ebben a fajlban, indoklassal. A szomszed
 * `partner-scope-usage.spec.ts` ugyanezt csinalja.
 *
 * === A MINTA NEM UJ ===
 *
 * A testver-lista (`WorksheetDocumentType`) ota all ilyen orzo a repoban
 * (`worksheet-generated-sheet-hely.spec.ts`). Az az allitas viszont a JELENLETET
 * nezi ertekenkent, tehat a BOVULES ellen nem ved: egy uj ertek csendben
 * bekerulhet. Ez a keszlet halmazt vet ossze, ezert mindket iranyt fogja.
 */

const SEMA = "../../packages/database/prisma/schema.prisma";
const KLIENS_TIPUS = "../../packages/types/src/asset-management.ts";
const MOBIL_TIPUS = "../../apps/mobile/src/lib/api/assets.ts";
const TAROLO_DTO = "src/service-assets/dto/asset.dto.ts";

const olvas = (ut: string): string => readFileSync(ut, "utf8");

/** A `enum AssetDocumentType { ... }` blokk ertekei a semabol. */
function semaErtekek(): string[] {
  const blokk = /enum AssetDocumentType \{([\s\S]*?)\}/.exec(olvas(SEMA));
  if (!blokk) throw new Error("nincs AssetDocumentType enum a sémában");
  return (blokk[1] ?? "")
    .split("\n")
    .map((sor) => sor.replace(/\/\/.*$/, "").trim())
    .filter((sor) => /^[A-Z_]+$/.test(sor));
}

/**
 * Egy `export type <nev> = "A" | "B";` union ertekei.
 *
 * A KOMMENTEKET LE KELL VENNI, ES EZ NEM ovatoskodas: mindket fajl fejlecében
 * idezojeles fajta-nevek allnak (peldaul `OTHER`), es azok nyers illesztessel
 * ertekké valnanak. A sajat prozank rontana el a merest.
 */
function unioErtekek(ut: string, nev: string): string[] {
  const torzs = olvas(ut).replace(/\/\*[\s\S]*?\*\//g, "");
  const minta = new RegExp(`export type ${nev}\\s*=([^;]*);`);
  const talalat = minta.exec(torzs);
  if (!talalat) throw new Error(`nincs ${nev} union ebben: ${ut}`);
  return [...(talalat[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]!);
}

describe("a dokumentum-fajtak listaja mind a negy helyen ugyanaz", () => {
  /*
    A VART HALMAZ KI VAN IRVA, NEM SZAMOLVA.

    Ha a lista valamelyik masik forrasbol jonne, a keszlet ONHIVATKOZO lenne:
    azt allitana, hogy ami a listaban van, az a listaban van. Egy KIESO ertéket
    igy sem venne eszre.

    A beegetett halmaz ITT VEDELEM, nem hazugsag (a kulonbseg a sajat lapomon:
    szamold, ha SZOVEG; beegetheted, ha ALLITAS). Ha a valosag elmozdul, ez
    PIROSRA valt, es valaki megnezi -- pontosan ez a cel.
  */
  const VART = ["INVOICE", "WARRANTY", "MANUAL", "OTHER", "PHOTO"];

  /*
    EZ AZ ALLITAS A MASODIK VEDVONAL, NEM AZ ELSO -- ES EZT MERTEM, NEM HISZEM.

    Megprobaltam kalibralni: kivettem a PHOTO erteket a semabol, es a keszlet
    NEM valtott pirosra. Az ok szerkezeti: a sema-valtozas ujragenerálja a
    Prisma klienst, a kod (`type === "PHOTO"`) LE SEM FORDUL, tehat nulla teszt
    fut. A sema es a KOD kozotti kotest tehat a FORDITO tartja.

    AMI MEGIS MARAD ENNEK AZ ALLITASNAK: az az eset, amikor a sema ES a kod
    EGYUTT mozdul (tehat a fordito elegedett), a masolatok viszont nem. Akkor a
    tobbi harom ag szol. Ezert all itt, es ezert nem allitom rola, hogy a
    kalibracio igazolta.
  */
  it("a séma enumja pontosan ez az öt érték", () => {
    assert.deepEqual(semaErtekek(), VART);
  });

  it("a szerver hatókör-szabályának listája ugyanez", () => {
    assert.deepEqual([...ASSET_DOCUMENT_TYPES], VART);
  });

  it("a kliens-oldali típus (packages/types) ugyanez", () => {
    assert.deepEqual(unioErtekek(KLIENS_TIPUS, "AssetDocumentType"), VART);
  });

  /*
    EZ AZ EGYETLEN ALLITAS, AMI OLYAN CSOMAGROL SZOL, AMIT A FORDITO NEM LAT.

    A mobil a pnpm workspace-en kivul all: `--filter` nem talalja, es a ket
    oldal kozott nincs tipus-kapcsolat. Az `assets.ts` viszont EGY FAJL, tehat
    OLVASHATO -- es ennyi eleg ahhoz, hogy a szetcsuszas ne legyen nema.
  */
  it("a mobil saját másolata ugyanez", () => {
    assert.deepEqual(unioErtekek(MOBIL_TIPUS, "AssetDocumentType"), VART);
  });

  /*
    ISMERT POZITIV KONTROLL A KIOLVASORA.

    A fenti negy allitas mind ugyanazt a halmazt varja, tehat ha a KIOLVASO
    romlana el ugyanugy mind a negy helyen (peldaul ures listat adna), akkor is
    "egyeznenek". Ez a kontroll azt meri, hogy a kiolvaso TUD-E kulonbseget
    tenni: egy ISMERTEN MASIK union masik halmazt kell hogy adjon.
  */
  it("KONTROLL: a kiolvasó egy másik uniót másként olvas", () => {
    const masik = unioErtekek(KLIENS_TIPUS, "AssetOwnerType");
    assert.deepEqual(masik, ["CUSTOMER", "SUPPLIER"]);
    assert.notDeepEqual(masik, VART);
  });

  /*
    ES AZ OTODIK PELDANY MEGSZUNT, 2026-09-22.

    A tarolo DTO-ja sajat, kezzel karbantartott masolatot tartott ugyanezzel a
    negy ertekkel, es a KET LISTA FEJLECE SZO SZERINT megjosolta a mai napot:
    "egy otodik fajta felvetelenel az egyik atvezetve marad, a masik nem -- es
    az elteres NEMA".

    Mostantol a DTO ujra-exportal, nem masol. Ez az allitas azert all itt, mert
    egy jovobeli "egyszerusites" (visszairni a listat a DTO-ba) kulonben
    eszrevetlen lenne: mind a negy fenti allitas zold maradna.
  */
  it("a tároló DTO-ja nem tart saját másolatot", () => {
    const dto = olvas(TAROLO_DTO);
    assert.match(
      dto,
      /export \{ ASSET_DOCUMENT_TYPES \} from "\.\.\/\.\.\/auth\/partner-scope\.util\.js";/,
    );
    assert.doesNotMatch(dto, /export const ASSET_DOCUMENT_TYPES\s*=/);
  });
});
