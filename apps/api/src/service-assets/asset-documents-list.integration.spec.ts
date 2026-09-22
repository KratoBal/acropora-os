import type { AuthenticatedUser } from "@acropora/types";
import type { AssetDocumentTypeValue } from "../auth/partner-scope.util.js";
import {
  belsosUser,
  szallitoUser,
  vevoUser,
} from "../testing/scope-user.fixture.js";
import "reflect-metadata";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import { DOCUMENT_THUMBNAIL_VARIANT } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { InMemoryDocumentStore } from "./document-store/in-memory-document-store.js";
import { ServiceAssetsRepository } from "./service-assets.repository.js";
import { ServiceAssetsService } from "./service-assets.service.js";

/**
 * AZ ESZKÖZ CSATOLMÁNY-LISTÁJA NEM TÁGABB MAGÁNÁL AZ ESZKÖZNÉL.
 *
 * === MIÉRT ADATBÁZISON, ÉS MIÉRT NEM ELÉG AZ EGYSÉGTESZT ===
 *
 * A bekötést (hogy a hívó hatóköre változatlanul megy tovább) hamis tárolóval
 * is meg lehet mérni, és a testvér-fájl meg is méri. A SZŰRÉST viszont nem: az
 * a betöltött SORON áll (`rowBelongsToScope` a tulajdonoson,
 * `scopeMaySeeDocumentType` az irat fajtáján), tehát egy hamis tároló pontosan
 * azt a két lépést hagyná ki, amit mérni akarunk.
 *
 * === A CSAPDA, AMIT EZ A FÁJL KIKERÜL ===
 *
 * Egy ÜRES lista és egy HATÓKÖRBŐL KIZÁRT lista ugyanúgy néz ki. Ha a másik
 * vevő eszközén nem állna dokumentum, ez a suite akkor is zöld lenne, ha a
 * szűrés teljesen hiányozna -- nem lenne mit kiszűrni. Ezért a másik vevő
 * eszközére KERÜL csatolmány, és külön állítás mondja ki, hogy belsős
 * hatókörrel MEG IS TALÁLHATÓ. A tiltás csak ezzel az ismert pozitív esettel
 * együtt bizonyít.
 */
const gate = integrationDatabaseGate(process.env);

const PREFIX = "ITADL";
const repository = new ServiceAssetsRepository();
const service = new ServiceAssetsService(
  repository,
  new InMemoryDocumentStore(),
);

/**
 * A HATOKORT MOSTANTOL A SZOLGALTATAS OLDJA FEL A FELHASZNALOBOL (2026-09-22),
 * mert a lathatosag mar nem csak a tulajdonrol szol, hanem a hozzarendelt
 * helyszinekrol is. A spec ezert USERT ad at, nem kesz hatokort.
 */
const BELSOS = belsosUser();

let vevoAId = "";
let vevoBId = "";
let eszkozAId = "";
let eszkozBId = "";
/** A kepes csatolmany a masik vevo eszkozen -- a belyegkep-ag merESEhez. */
let kepDokumentumId = "";
let szamlaKepDokumentumId = "";
let actorUserId = "";
let helyszinAId = "";
let helyszinBId = "";
let vevoAUser: AuthenticatedUser;
let vevoBUser: AuthenticatedUser;

function sha256() {
  return randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64);
}

async function removeLeftovers() {
  await prisma.assetDocument.deleteMany({
    where: { asset: { assetNumber: { startsWith: PREFIX } } },
  });
  await prisma.assetEvent.deleteMany({
    where: { asset: { assetNumber: { startsWith: PREFIX } } },
  });
  await prisma.asset.deleteMany({
    where: { assetNumber: { startsWith: PREFIX } },
  });
  // A HOZZARENDELESEK a felhasznaloval egyutt kaszkadolnak, a HELYSZIN viszont
  // nem: azt kulon kell torolni, es az ESZKOZOK UTAN, mert a `departmentId`
  // `Restrict`. Ugyanaz a sorrend, mint a szomszed lathatosagi meresben.
  await prisma.userWorksheetDepartment.deleteMany({
    where: {
      department: { customer: { customerNumber: { startsWith: PREFIX } } },
    },
  });
  await prisma.worksheetDepartment.deleteMany({
    where: { customer: { customerNumber: { startsWith: PREFIX } } },
  });
  /*
    A FELHASZNALOK A VEVO ELOTT MENNEK, ES EZ 2026-09-22 OTA IGY VAN.

    A portal-felhasznalo `customerId` mezoje idegen kulcs a vevore
    (`User_customerId_fkey`), es NEM kaszkadol. A regi sorrend (vevo, aztan
    felhasznalo) azert mukodott, mert ez a fixtura addig CSAK aktor-felhasznalot
    hozott letre, vevo nelkul.

    Merve a CI-ban ugyanezen a napon: a regi sorrend `hookFailed`-del allt meg,
    es a suite HUSZONNEGY allitasa EL SEM INDULT. A kulonbseg szamit: ha az
    allitas bukik, a mert dolog rossz; ha a horog, a meres meg sem tortent.
  */
  await prisma.user.deleteMany({
    where: { email: { startsWith: PREFIX.toLowerCase() } },
  });
  await prisma.customer.deleteMany({
    where: { customerNumber: { startsWith: PREFIX } },
  });
}

async function vevo(sorszam: number) {
  const row = await prisma.customer.create({
    data: {
      customerNumber: `${PREFIX}-${sorszam}`,
      displayName: `${PREFIX} vevő ${sorszam}`,
      type: "COMPANY",
    },
    select: { id: true },
  });
  return row.id;
}

async function helyszin(customerId: string, kod: string) {
  const row = await prisma.worksheetDepartment.create({
    data: { customerId, code: kod, name: `${PREFIX} ${kod}` },
    select: { id: true },
  });
  return row.id;
}

/**
 * PORTAL-FELHASZNALO A HOZZARENDELESEVEL EGYUTT.
 *
 * A hozzarendeles NEM dísz: a szolgaltatas a felhasznalo azonositojabol kerdezi
 * le, mely helyszineket lathatja. Egy hozzarendeles nelkuli felhasznalo SEMMIT
 * nem latna -- es akkor minden alabbi tiltas zold lenne, barmit is csinal a kod.
 */
async function portalUser(
  customerId: string,
  departmentId: string,
  jel: string,
): Promise<AuthenticatedUser> {
  const row = await prisma.user.create({
    data: {
      email: `${PREFIX.toLowerCase()}-portal-${jel}@example.invalid`,
      displayName: `${PREFIX} portál ${jel}`,
      role: "PARTNER_SERVICE",
      customerId,
    },
    select: { id: true, email: true, displayName: true },
  });
  await prisma.userWorksheetDepartment.create({
    data: { userId: row.id, departmentId },
  });
  return vevoUser(customerId, {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
  });
}

async function eszkoz(
  customerId: string,
  departmentId: string,
  sorszam: number,
) {
  const row = await prisma.asset.create({
    data: {
      assetNumber: `${PREFIX}-${sorszam}`,
      name: `${PREFIX} teszteszköz ${sorszam}`,
      kind: "EQUIPMENT",
      customerId,
      // A HELYSZIN 2026-09-22 OTA KELL: a partner-hatokoru lathatosag a
      // HOZZARENDELT helyszinekre szur, es a `departmentId` NULL erteke azon
      // nem menne at. Helyszin nelkul ez a spec nem a tipus-szurest merne,
      // hanem egy ures listat.
      departmentId,
      createdById: actorUserId,
      qrToken: randomUUID(),
    },
    select: { id: true },
  });
  return row.id;
}

async function csatolmany(
  assetId: string,
  type: AssetDocumentTypeValue,
  fileName: string,
) {
  await repository.addDocument({
    assetId,
    type,
    fileName,
    content: Buffer.from("proba"),
    sizeBytes: 5,
    sha256: sha256(),
    contentType: "application/pdf",
    // PDF: belyegkep nem keszul hozza, es a lista nem is ker ilyet.
    thumbnail: null,
    caption: null,
    actorUserId,
  });
}

/**
 * KEPES CSATOLMANY, BELYEGKEPPEL -- a belyegkep-ag hatokorehez kell.
 *
 * A PDF-es valtozat `thumbnail: null`-t ad, es azon a `documentBytes` SOHA nem
 * lepne be a belyegkep-agba: a `wantsThumbnail` utan a `documentThumbnail`
 * ures kezzel ter vissza, es a hivas a VISSZAESESRE megy, ahol MASIK
 * hatokor-ellenorzes all. Vagyis egy PDF-fel merve a lenti allitas akkor is
 * zold lenne, ha a belyegkep-lekerdezesbol hianyozna a hatokor.
 */
async function kepesCsatolmany(
  assetId: string,
  fileName: string,
  /*
    A TIPUS MOSTANTOL PARAMETER, ES EZ A TIPUS-KAPU MERESEHEZ KELL.
    Az alapertelmezes valtozatlanul `MANUAL` (lasd a lenti indoklast); egy
    TILTOTT tipusu, DE BELYEGKEPES sor az egyetlen alak, amin a belyegkep-ag
    tipus-kapuja egyaltalan merheto.
  */
  type: AssetDocumentTypeValue = "MANUAL",
) {
  return repository.addDocument({
    assetId,
    /*
      `MANUAL`, ES EZ NEM IZLES. A `scopeMaySeeDocumentType` szerint egy vevo
      CSAK `WARRANTY` vagy `MANUAL` tipust lat. `OTHER`-rel a jogos kero sem
      kapna meg a belyegkepet: a `documentThumbnail` ures kezzel terne vissza,
      a hivas atesne a `this.document(...)` agra, es a belyegkep-ag EGYSZER SEM
      futna le. A negativ allitast akkor a TIPUS dontene el, nem a hatokor --
      vagyis a javitas nelkul is ugyanugy nezne ki.
    */
    type,
    fileName,
    content: Buffer.from("eredeti-kep"),
    sizeBytes: 11,
    sha256: sha256(),
    contentType: "image/png",
    thumbnail: Buffer.from("belyegkep"),
    caption: null,
    actorUserId,
  });
}

describe(
  "egy eszköz csatolmány-listája, hatókörrel",
  { skip: gate.mode === "skip" },
  () => {
    before(async () => {
      // A "refuse" NEM ugyanaz, mint a "skip": ott a hívó KÉRTE az integrációs
      // futást, és hiányzik hozzá valami. Csendben kihagyni azt jelentené,
      // hogy a CI zölden áll egy mérésre, ami el sem indult.
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await removeLeftovers();

      const user = await prisma.user.create({
        data: {
          email: `${PREFIX.toLowerCase()}-actor@example.invalid`,
          displayName: `${PREFIX} aktor`,
          role: "SERVICE",
        },
        select: { id: true },
      });
      actorUserId = user.id;

      vevoAId = await vevo(1);
      vevoBId = await vevo(2);
      helyszinAId = await helyszin(vevoAId, "HA");
      helyszinBId = await helyszin(vevoBId, "HB");
      vevoAUser = await portalUser(vevoAId, helyszinAId, "a");
      vevoBUser = await portalUser(vevoBId, helyszinBId, "b");
      eszkozAId = await eszkoz(vevoAId, helyszinAId, 1);
      eszkozBId = await eszkoz(vevoBId, helyszinBId, 2);

      await csatolmany(eszkozAId, "MANUAL", `${PREFIX}-kezikonyv.pdf`);
      await csatolmany(eszkozAId, "INVOICE", `${PREFIX}-szamla.pdf`);
      // A MÁSIK VEVŐ ESZKÖZÉN IS ÁLL CSATOLMÁNY -- e nélkül a lenti tiltás egy
      // üres eszközön is zöld lenne, és semmit nem bizonyítana.
      await csatolmany(eszkozBId, "MANUAL", `${PREFIX}-masik-vevo.pdf`);
      /*
        A KEPES CSATOLMANY IS ITT KESZUL, NEM A SAJAT TESZTJEBEN -- KULONBEN A
        SUITE SORRENDFUGGO LENNE. A `node --test` deklaracios sorrendben fut,
        tehat egy tesztben letrehozott sor a KESOBBI allitasok szamait mozditja,
        a korabbiakét nem. Aki atrendezi a teszteket, vagy egyetlen tesztet
        futtat `--test-name-pattern`-nel, egy olyan allitason kapna pirosat,
        amihez semmi koze.
      */
      kepDokumentumId = (await kepesCsatolmany(eszkozBId, `${PREFIX}-kep.png`))
        .id;
      /*
        TILTOTT TIPUSU, DE BELYEGKEPES SOR -- a tipus-kapu merESEhez.
        Ugyanazon a vevo eszkozen all, mint a fenti kep: a hatokor-kapu tehat
        ATENGEDI, es ami elutasit, az CSAK a tipus lehet.
      */
      szamlaKepDokumentumId = (
        await kepesCsatolmany(eszkozBId, `${PREFIX}-szamla-kep.png`, "INVOICE")
      ).id;
    });

    after(async () => {
      /**
       * A TAKARÍTÁS ELŐTTI SZÁMOK A FIXTÚRÁRÓL SZÓLNAK, NEM A MARADÉKRÓL.
       *
       * Ha ezek nullák lennének, a suite egy ÜRES adatbázison futott volna, és
       * MINDEN állítása zöld lett volna -- a tiltások azért, mert nincs mit
       * kiszűrni, a pozitív kontroll pedig azért nem szólna, mert a hibája
       * ugyanabból az okból marad néma.
       */
      const [dokumentumok, eszkozok, vevok] = await Promise.all([
        prisma.assetDocument.count({
          where: { asset: { assetNumber: { startsWith: PREFIX } } },
        }),
        prisma.asset.count({ where: { assetNumber: { startsWith: PREFIX } } }),
        prisma.customer.count({
          where: { customerNumber: { startsWith: PREFIX } },
        }),
      ]);

      await removeLeftovers();

      // ÉS A TAKARÍTÁS UTÁNI SZÁMOK a maradékról. A `nincsMaradek` MINDET
      // felsorolja, nem áll meg az elsőnél -- a számokat ezért a törlés UTÁN
      // kell mérni, különben az állítás olyat mondana, amit nem nézett meg.
      const [maradtDokumentum, maradtEszkoz, maradtVevo] = await Promise.all([
        prisma.assetDocument.count({
          where: { asset: { assetNumber: { startsWith: PREFIX } } },
        }),
        prisma.asset.count({ where: { assetNumber: { startsWith: PREFIX } } }),
        prisma.customer.count({
          where: { customerNumber: { startsWith: PREFIX } },
        }),
      ]);
      nincsMaradek([
        { nev: "AssetDocument (prefix szerint)", darab: maradtDokumentum },
        { nev: "Asset (prefix szerint)", darab: maradtEszkoz },
        { nev: "Customer (prefix szerint)", darab: maradtVevo },
      ]);

      // OT: harom PDF plusz KET belyegkepes kep (hatokor- es tipus-kapu).
      assert.equal(dokumentumok, 5);
      assert.equal(eszkozok, 2);
      assert.equal(vevok, 2);
      await prisma.$disconnect();
    });

    /**
     * KONTROLL A FIXTURARA, ES MAST MER, MINT AZ ALATTA ALLO ISMERT POZITIV.
     *
     * Az alatta allo azt bizonyitja, hogy a lista MEG TUDJA talalni mind a
     * kettot. Ez azt, hogy a ket portal-felhasznalo hozzarendelese
     * KULONBOZIK -- mert 2026-09-22 ota a vevo-hatokoru olvasas a
     * HOZZARENDELT helyszinekre szur.
     *
     * AMI NELKULE ELVESZNE, ES CSENDBEN: ha valaki a fixturat ugy "javitja",
     * hogy mindket felhasznalonak MINDKET helyszint adja, az osszes lenti
     * tiltas ZOLD MARAD egy MINDENT ATENGEDO szuro mellett is. A defektus
     * maga elegiti ki a tobbi allitast.
     *
     * A `portalUser` fejleceben ez a feltetel MONDATKENT mar allt. Egy
     * mondat, amit nem allit senki, a sajat vedelmet nem meri.
     */
    it("kontroll: mindkét portál-felhasználónak PONTOSAN EGY, és KÜLÖNBÖZŐ helyszíne van", async () => {
      const [a, b] = await Promise.all([
        prisma.userWorksheetDepartment.findMany({
          where: { userId: vevoAUser.id },
          select: { departmentId: true },
        }),
        prisma.userWorksheetDepartment.findMany({
          where: { userId: vevoBUser.id },
          select: { departmentId: true },
        }),
      ]);

      assert.deepEqual(
        a.map((sor) => sor.departmentId),
        [helyszinAId],
      );
      assert.deepEqual(
        b.map((sor) => sor.departmentId),
        [helyszinBId],
      );
      assert.notEqual(helyszinAId, helyszinBId);
    });

    /**
     * ISMERT POZITÍV KONTROLL: a lista MEG TUDJA találni mind a kettőt, amikor
     * a hívó mindent láthat. Enélkül minden lenti tiltás egy olyan metódustól
     * is zöld lenne, ami sosem ad vissza semmit.
     */
    it("belsős hívó mind a két csatolmányt látja", async () => {
      const { items } = await service.documents(eszkozAId, BELSOS);
      assert.deepEqual(items.map((sor) => sor.type).sort(), [
        "INVOICE",
        "MANUAL",
      ]);
    });

    /**
     * A TÍPUS-SZŰRÉS: a saját eszköz SZÁMLÁJA sem megy ki a vevőnek. A
     * tulajdonos-egyeztetés önmagában nem elég, és ez a sor pontosan azt méri,
     * hogy a lista a második szűrést is örökli az adatlaptól.
     */
    it("a vevő a saját eszközén sem látja a számlát", async () => {
      const { items } = await service.documents(eszkozAId, vevoAUser);
      assert.deepEqual(
        items.map((sor) => sor.type),
        ["MANUAL"],
      );
    });

    /**
     * A TULAJDONOS-SZŰRÉS, ÉS EZ A KIKÖTÉS SZÍVE: a másik vevő eszközének VAN
     * csatolmánya (a belsős ág fentebb meg is találja), mégis 404 jön, nem üres
     * lista. Az üres lista azt állítaná, hogy nincs mit látni -- holott van,
     * csak nem a kérőé.
     */
    it("idegen vevő eszközének csatolmányai nem láthatók", async () => {
      await assert.rejects(
        () => service.documents(eszkozBId, vevoAUser),
        /Az eszköz nem található/,
      );

      // ÉS A MÁSIK VEVŐ ESZKÖZÉN TÉNYLEG ÁLL SOR: enélkül a fenti elutasítás
      // egy üres eszközön is ugyanígy nézne ki.
      const { items } = await service.documents(eszkozBId, BELSOS);
      // HAROM: a PDF es KET belyegkepes kep, mind a harom a masik vevo eszkozen.
      assert.equal(items.length, 3);
    });

    /**
     * A BELYEGKEP-AG SAJAT LEKERDEZESSEL FUT, ES SAJAT HATOKORREL (2026-09-22).
     *
     * A `documentBytes` a `variant=thumbnail` keresre ELOSZOR a
     * `repository.documentThumbnail`-t hivja, es CSAK ha az ures kezzel ter
     * vissza, esik at a `this.document(...)` agra, ahol a masik
     * hatokor-ellenorzes all. Vagyis a belyegkepet a SAJAT lekerdezesenek
     * szukitese vedi -- ha abbol kiesne a hatokor, egy idegen partner a
     * `variant=thumbnail` keressel megkerulne a lenti, mar mert tiltast.
     *
     * EDDIG EZT CSAK FORRAS-SZOVEG ORIZTE (`document-thumbnail-wiring.spec.ts`
     * es `asset-detail-scope.spec.ts`). Egy forras-allitas a TORLEST elkapja,
     * a KIKAPCSOLAST nem: ha a szukites a helyen marad, de mar nem hat, a
     * szoveg valtozatlan, es mind a ketto zold marad.
     *
     * A KEPES CSATOLMANY NEM RESZLET: a suite tobbi sora PDF, `thumbnail:
     * null`-lal, es azon a `documentThumbnail` amugy is ures kezzel ter
     * vissza -- ez az allitas ott a VISSZAESEST merne, nem a belyegkep-agat.
     */
    it("idegen vevő a bélyegképet sem éri el a variant=thumbnail kéréssel", async () => {
      // ISMERT POZITIV KONTROLL: a belyegkep-ag LETEZIK es ad is vissza valamit
      // a jogos kerőnek. Enelkul a lenti elutasitas egy sosem mukodo agon is
      // ugyanigy nezne ki.
      const sajat = await service.documentBytes(
        eszkozBId,
        kepDokumentumId,
        vevoBUser,
        DOCUMENT_THUMBNAIL_VARIANT,
      );
      assert.deepEqual(
        Buffer.from(sajat.bytes),
        Buffer.from("belyegkep"),
        "a jogos kérő nem a bélyegképet kapta -- az ág nem is futott le",
      );

      await assert.rejects(
        () =>
          service.documentBytes(
            eszkozBId,
            kepDokumentumId,
            vevoAUser,
            DOCUMENT_THUMBNAIL_VARIANT,
          ),
        /*
          A MONDAT A DOKUMENTUMROL SZOL, NEM AZ ESZKOZROL, es ez nem veletlen:
          a `service.document(...)` MINDIG ezt dobja, akkor is, ha valojaban az
          ESZKOZ volt lathatatlan. Egy uzenet, ket kulonbozo ok.

          AMIT EZ AZ ALLITAS EZERT NEM MOND MEG: hogy melyik kapu utasitott el.
          Amit MEGMOND: hogy bajt NEM jott vissza -- es a kikapcsolt hatokornel
          eppen az jonne, kivetel nelkul. A megkulonboztetest a POZITIV
          KONTROLL adja: az bizonyitja, hogy a belyegkep-ag egyaltalan mukodik.
        */
        /A dokumentum nem található/,
      );
    });

    /**
     * A BELYEGKEP-AG TIPUS-KAPUJA, ES EDDIG EZT SEMMI NEM MERTE.
     *
     * A `documentThumbnail` KET kaput visel: a hatokort es a dokumentum-fajtat
     * (`if (!scopeMaySeeDocumentType(row.type, scope)) return null;`). A fenti
     * allitas a HATOKORT meri -- idegen vevovel. A TIPUS-kapura viszont ott
     * semmi nem szol: a kepes sor `MANUAL`, amit a vevo LATHAT, a jogos kero
     * pedig epp ezert kapja meg.
     *
     * EZ AZ ALLITAS A MASIK TENGELY: SAJAT eszkoz, SAJAT vevo, tehat a
     * hatokor-kapu ATENGEDI -- es ami elutasit, az CSAK a tipus lehet.
     *
     * AMIT A JELENLEGI KOD CSINAL: a tipus-kapu miatt a `documentThumbnail`
     * URES kezzel ter vissza, a hivas atesik a `this.document(...)` agra, es
     * OTT a masik tipus-ellenorzes utasitja el. Vagyis ma ketto ved.
     *
     * AMI A RONTASNAL TORTENIK: ha a belyegkep-ag tipus-kapujat kivesszuk, a
     * `documentThumbnail` VISSZAADJA a belyegkepet, a visszaeses el sem indul,
     * es a szamla csempeje kimegy a vevonek. Egy belyegkep ugyanannak a kepnek
     * a kicsinyitett masa: ez szivargas, csak kisebb felbontasban.
     *
     * EDDIG EZT CSAK FORRAS-SZOVEG ORIZTE (`document-thumbnail-wiring.spec.ts`
     * 205. sora). Az a statikus allitas MARAD, horgonynak: a TORLEST tovabbra
     * is az fogja meg, a KIKAPCSOLAST ez.
     */
    it("a vevő a SAJÁT eszközén sem éri el a számla bélyegképét", async () => {
      /*
        ISMERT POZITIV KONTROLL, UGYANAZZAL A VEVOVEL ES UGYANAZON AZ ESZKOZON:
        a belyegkep-ag ennek a kerőnek MUKODIK. Enelkul a lenti elutasitas egy
        olyan agon is ugyanigy nezne ki, ami ennel a vevonel sosem fut le --
        es akkor a tipusrol semmit nem mondana.
      */
      const engedett = await service.documentBytes(
        eszkozBId,
        kepDokumentumId,
        vevoBUser,
        DOCUMENT_THUMBNAIL_VARIANT,
      );
      assert.deepEqual(
        Buffer.from(engedett.bytes),
        Buffer.from("belyegkep"),
        "a jogos kérő nem a bélyegképet kapta -- az ág nem is futott le",
      );

      await assert.rejects(
        () =>
          service.documentBytes(
            eszkozBId,
            szamlaKepDokumentumId,
            vevoBUser,
            DOCUMENT_THUMBNAIL_VARIANT,
          ),
        /A dokumentum nem található/,
      );
    });

    /**
     * A MÁSIK TENGELY: a szállító-hatókörű hívó sem látja a vevő eszközét. Egy
     * szűrés, ami csak az egyik oszlopot nézi, a fenti állításon átmenne.
     */
    it("szállító-hatókörű hívó sem látja a vevő eszközét", async () => {
      await assert.rejects(
        () =>
          // SZALLITO-hatokor UGYANARRA az azonositora: a ket oszlop kozul csak
          // az egyik egyezik, tehat ha a szures csak a `customerId`-t
          // nezne, ez a hivas atmenne.
          service.documents(eszkozAId, szallitoUser(vevoAId)),
        /Az eszköz nem található/,
      );
    });
  },
);
