import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

import { hashPassword } from "../users/password.util.js";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

/**
 * KI IRJA ALA A LAPOT, ES HONNAN JON A NEVE.
 *
 * A forrast a SZERVER szamolja, nem a kliens kuldi: egy klienstol jovo "forras"
 * mezo ellentmondhatna a valasztott szemelynek, es akkor a lapon egy HAMIS
 * jelzes allna. Ezek az allitasok azt kotik le, hogy ez igy is marad.
 */

const CREATED_AT = new Date("2026-09-04T08:00:00.000Z");

/**
 * A LAP SORA, AMIT A SZOLGALTATAS A SIKERES ALAIRAS UTAN VISSZAAD.
 *
 * A VARRAT MIATT KELL, ES NEM DISZ: a `sign` a vegen a TELJES lapot adja
 * vissza, es ahhoz a `versions[0]` sor is kell. Egy szukebb dupla a nem-hibas
 * agon `Cannot read properties of undefined` hibaval szallna el -- es a teszt
 * akkor nem a szabalyrol szolna, hanem a duplarol. (Merve: pontosan ez
 * tortent az elso valtozattal.)
 */
function worksheetRow() {
  return {
    id: "worksheet-1",
    number: null,
    numberYear: null,
    sequence: null,
    customerId: "customer-1",
    departmentId: "department-1",
    createdById: "szerelo-1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    customer: {
      id: "customer-1",
      customerNumber: "VEVO-1",
      displayName: "Fővárosi Állat- És Növénykert",
      worksheetPartnerCode: "FANK",
    },
    department: {
      id: "department-1",
      code: "BIO",
      name: "Biodóm",
      isActive: true,
    },
    createdBy: { displayName: "Szerelő Sándor" },
    assignees: [],
    versions: [
      {
        id: "version-1",
        worksheetId: "worksheet-1",
        version: 1,
        status: "AWAITING_SIGNATURE",
        subject: "Kompresszor",
        unitName: null,
        description: null,
        issueDate: null,
        fulfillmentDate: null,
        dueDate: null,
        currency: "HUF",
        netAmount: new Prisma.Decimal("30000"),
        vatAmount: new Prisma.Decimal("8100"),
        grossAmount: new Prisma.Decimal("38100"),
        changeReason: null,
        createdById: "szerelo-1",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        closedAt: null,
        closedById: null,
        createdBy: { displayName: "Szerelő Sándor" },
        closedBy: null,
        signature: null,
        lines: [],
      },
    ],
  };
}

const KOD = "0000";
let KOD_HASH = "";

const CONTACTS = [
  { id: "kontakt-1", name: "Vevő Vilmos" },
  { id: "kontakt-2", name: "Vevő Vera" },
];

function repository(overrides: Record<string, unknown> = {}) {
  return {
    detail: async () => worksheetRow(),
    customerContacts: async () => CONTACTS,
    /**
     * A VARRAT: a szolgaltatas MINDEN listarol valasztott alairasnal ezt hivja.
     * Ha a duplabol hianyozna, minden ilyen ag `undefined`-ot hivna
     * fuggvenykent, es a hiba nem a szabalyrol szolna, hanem a duplarol.
     *
     * Az ertek a `0000` scrypt-hashe, ugyanabbol a fuggvenybol, amit a valodi
     * kod hasznal -- egy kezzel kitalalt "hash" itt sosem egyezne, es a
     * tesztek a rossz okbol lennenek zoldek.
     */
    signingCodeHash: async () => KOD_HASH,
    isSelectablePartner: async () => true,
    sign: async () => ({ ok: true }) as const,
    ...overrides,
  } as unknown as WorksheetsRepository;
}

function service(overrides: Record<string, unknown> = {}) {
  return new WorksheetsService(repository(overrides));
}

before(async () => {
  KOD_HASH = await hashPassword(KOD);
});

describe("az aláíró feloldása", () => {
  it("a LISTÁRÓL választott aláírónál a NEVET a választott sor adja", async () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A FAJLBAN. Ha a nevet a kliens kuldhetne,
      a lapra MAS nev kerulne, mint akit valasztottak -- es a jelzes szerint a
      partner nyilvantartott munkatarsa irta ala.

      MI PIROSIT: ha a szolgaltatas a `signerName` mezot hasznalna, amikor van
      `signerUserId`.
    */
    const kapott: Record<string, unknown>[] = [];
    await service({
      sign: async (input: Record<string, unknown>) => {
        kapott.push(input);
        return { ok: true } as const;
      },
    }).sign(
      "worksheet-1",
      {
        decision: "ACCEPTED",
        signerUserId: "kontakt-2",
        signerName: "Hamis Hugó",
        signatureCode: KOD,
        note: null,
      } as never,
      "szerelo-1",
    );
    assert.equal(kapott[0]?.signerName, "Vevő Vera");
    assert.equal(kapott[0]?.signerUserId, "kontakt-2");
    assert.equal(kapott[0]?.signerSource, "SELECTED");
  });

  it("IDEGEN aláírót nem fogad el", async () => {
    /*
      Enelkul a hivo BARMELYIK felhasznalo azonositojat kuldhetne, es a lapra
      egy idegen ember neve kerulne -- ugy, hogy a jelzes szerint a partner
      munkatarsa irta ala. A halmaz a lap partnerehez kotott fiokoke.

      MI PIROSIT: az ellenorzes elhagyasa.
    */
    await assert.rejects(
      () =>
        service().sign(
          "worksheet-1",
          {
            decision: "ACCEPTED",
            signerUserId: "idegen-9",
            signatureCode: KOD,
            note: null,
          } as never,
          "szerelo-1",
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /nem a munkalap partnerének munkatársa/.test(error.message),
    );
  });

  it("az EGYIK SEM ágon a beírt név megy, és a forrás TYPED", async () => {
    /*
      Ez az az ag, amit a lap KIMOND: nem a partner nyilvantartott munkatarsa
      irta ala. A forras TAROLT allapot, nem kepernyo-szoveg.

      MI PIROSIT: ha a forras itt is `SELECTED` lenne -- olyankor a ket ag a
      lapon megkulonboztethetetlen lenne, es a jelzes ertelme veszne el.
    */
    const kapott: Record<string, unknown>[] = [];
    await service({
      sign: async (input: Record<string, unknown>) => {
        kapott.push(input);
        return { ok: true } as const;
      },
    }).sign(
      "worksheet-1",
      {
        decision: "ACCEPTED",
        signerName: "  Kovács Kázmér  ",
        note: null,
      } as never,
      "szerelo-1",
    );
    assert.equal(kapott[0]?.signerName, "Kovács Kázmér");
    assert.equal(kapott[0]?.signerUserId, null);
    assert.equal(kapott[0]?.signerSource, "TYPED");
  });

  it("NÉV NÉLKÜL és VÁLASZTÁS NÉLKÜL nem lehet aláírni", async () => {
    /*
      A kotelezoseg a SZOLGALTATASBAN all, nem a DTO dekoratorain, mert KET
      mezot kot ossze. A DTO-ban a nev elhagyhato lett -- ha itt sem allna
      kapu, a lap NEV NELKUL lenne alairhato.

      MI PIROSIT: a hossz-ellenorzes elhagyasa.
    */
    await assert.rejects(
      () =>
        service().sign(
          "worksheet-1",
          { decision: "ACCEPTED", signerName: " ", note: null } as never,
          "szerelo-1",
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /Válassz aláírót a listáról/.test(error.message),
    );
  });
});

describe("az aláírók listája", () => {
  it("ÜRES listánál MEGMONDJA, melyik ok áll fenn", async () => {
    /*
      Ket kulonbozo ok van, es a teendojuk MAS: nincs hozzakotott munkatars,
      vagy a lap partnere nem valaszthato szervizpartner. Egy nema ures lista
      mind a kettore raillik.

      MI PIROSIT: ha az `emptyReason` mindket agon ugyanaz lenne, vagy `null`.
    */
    const nincsMunkatars = await service({
      customerContacts: async () => [],
    }).signerCandidates("worksheet-1");
    const nincsTorzsadat = await service({
      customerContacts: async () => [],
      isSelectablePartner: async () => false,
    }).signerCandidates("worksheet-1");
    assert.notEqual(nincsMunkatars.emptyReason, null);
    assert.notEqual(nincsMunkatars.emptyReason, nincsTorzsadat.emptyReason);
  });

  it("NEM üres listánál nincs mondat", async () => {
    const out = await service().signerCandidates("worksheet-1");
    assert.equal(out.items.length, 2);
    assert.equal(out.emptyReason, null);
  });
});

/**
 * AZ ALAIROKOD A SZERVEREN.
 *
 * A legordulo azt rogziti, KINEK mondta magat az alairo; a kod az, ami ezt
 * bizonyitja. Ezek az allitasok azt kotik le, hogy a kapu NEM engedheto meg
 * -- kulonben a lapon egy ellenorzottnek latszo alairas allna.
 */
describe("az aláírókód ellenőrzése", () => {
  it("KÓD NÉLKÜL a listáról választott aláírás NEM megy át", async () => {
    /*
      MI PIROSIT: a kapu elhagyasa. Olyankor a legordulos ag ugyanugy mukodne,
      mint a kod elott -- es a lap ugyanazt allitana, mint egy ellenorzott
      alairasrol. A hianyzo bizonyitek megkulonboztethetetlen lenne a
      meglevotol.
    */
    await assert.rejects(
      () =>
        service().sign(
          "worksheet-1",
          {
            decision: "ACCEPTED",
            signerUserId: "kontakt-1",
            note: null,
          } as never,
          "szerelo-1",
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /négy számjegy/.test(error.message),
    );
  });

  it("ROSSZ ALAKÚ kód sem", async () => {
    await assert.rejects(
      () =>
        service().sign(
          "worksheet-1",
          {
            decision: "ACCEPTED",
            signerUserId: "kontakt-1",
            signatureCode: "12",
            note: null,
          } as never,
          "szerelo-1",
        ),
      BadRequestException,
    );
  });

  it("NEM EGYEZŐ kód sem, és a mondat MÁS, mint a hiányzó kódé", async () => {
    /*
      A ket eset TEENDOJE mas: a hianyzo TAROLT kod a fiokrol szol (szolj az
      irodanak), az elteres arrol, hogy az ott allo ember nem tudja a kodot.

      MI PIROSIT: kozos mondat a ket agra.
    */
    await assert.rejects(
      () =>
        service().sign(
          "worksheet-1",
          {
            decision: "ACCEPTED",
            signerUserId: "kontakt-1",
            signatureCode: "9999",
            note: null,
          } as never,
          "szerelo-1",
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /nem egyezik/.test(error.message),
    );
  });

  it("HIÁNYZÓ TÁROLT kód esetén SOHA nem enged át", async () => {
    /*
      EZ A LEGFONTOSABB ALLITAS EBBEN A CSOPORTBAN. Egy "nincs kod, tehat
      atengedjuk" ag pontosan azt a bizonyito erot venne el, amiert az egesz
      keszul.

      ES EZ AZ ALLITAS NEM HALOTT, PEDIG A MIGRACIO MINDEN SORT FELTOLT.
      Acrobot pont erre kerdezett ra: ha minden soron van hash, a "nincs hash"
      ag SOHA nem futna le, es a teszt zold maradna akkor is, ha rossz. Azert
      nem halott, mert a dupla ITT SZANDEKOSAN `null`-t ad -- vagyis az agat
      nem az adatbazis allapota hozza elo, hanem a fixture. Merve: a kapu
      kivetele pontosan EZT az allitast pirositja.

      MI PIROSIT: ha a hianyzo hash atengedne. A mondat az IRODARA mutat, mert
      ez nem a beiro hibaja.
    */
    await assert.rejects(
      () =>
        service({ signingCodeHash: async () => null }).sign(
          "worksheet-1",
          {
            decision: "ACCEPTED",
            signerUserId: "kontakt-1",
            signatureCode: "0000",
            note: null,
          } as never,
          "szerelo-1",
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /Szólj az irodának/.test(error.message),
    );
  });

  it("az EGYIK SEM ágon NINCS kód, és ez nem kiskapu", async () => {
    /*
      TESTVER-KONTROLL, ES KI KELL MONDANI, MIERT NEM KISKAPU: ezen az agon a
      lap MAGA MONDJA KI, hogy nem a partner nyilvantartott munkatarsa irta ala
      (`signerSource: TYPED`). A kod hianya tehat nem rejtve marad, hanem a
      dokumentum resze lesz.

      MI PIROSIT: ha a kod-kapu ezen az agon is elsulne -- olyankor a szabad
      szoveges ut jarhatatlanna valna, es a szerelo ott allna a helyszinen.
    */
    const kapott: Record<string, unknown>[] = [];
    await service({
      sign: async (input: Record<string, unknown>) => {
        kapott.push(input);
        return { ok: true } as const;
      },
    }).sign(
      "worksheet-1",
      {
        decision: "ACCEPTED",
        signerName: "Kovács Kázmér",
        note: null,
      } as never,
      "szerelo-1",
    );
    assert.equal(kapott[0]?.signerSource, "TYPED");
  });
});
