import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@acropora/database";

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

const CONTACTS = [
  { id: "kontakt-1", name: "Vevő Vilmos" },
  { id: "kontakt-2", name: "Vevő Vera" },
];

function repository(overrides: Record<string, unknown> = {}) {
  return {
    detail: async () => worksheetRow(),
    customerContacts: async () => CONTACTS,
    isSelectablePartner: async () => true,
    sign: async () => ({ ok: true }) as const,
    ...overrides,
  } as unknown as WorksheetsRepository;
}

function service(overrides: Record<string, unknown> = {}) {
  return new WorksheetsService(repository(overrides));
}

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
