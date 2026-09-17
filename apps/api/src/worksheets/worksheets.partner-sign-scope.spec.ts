import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";

const PARTNER = {
  id: "partner-a-user",
  role: "PARTNER_SERVICE",
  customerId: "customer-a",
  supplierId: null,
} as AuthenticatedUser;

const SAJAT_LAP_ID = "customer-a-sheet";
const KELT = new Date("2026-09-17T08:00:00.000Z");

/** A MINIMALIS SOR, amit a szolgaltatas a sajat lapnal visszakap. */
function sajatLap() {
  return {
    id: SAJAT_LAP_ID,
    number: null,
    numberYear: null,
    sequence: null,
    customerId: "customer-a",
    departmentId: "department-1",
    createdById: "szerelo-1",
    createdAt: KELT,
    updatedAt: KELT,
    customer: {
      id: "customer-a",
      customerNumber: "VEVO-A",
      displayName: "A Partner",
      worksheetPartnerCode: "APRT",
    },
    department: {
      id: "department-1",
      code: "BIO",
      name: "Biodóm",
      isActive: true,
    },
    createdBy: { displayName: "Szerelő Sándor" },
    assignees: [],
    assets: [],
    /*
      A VERZIO NEM ELHAGYHATO, ES EZT A MERES TANITOTTA MEG: ures listaval a
      lekepezes `WORKSHEET_WITHOUT_VERSION` hibaval all meg, MIELOTT a hatokor
      barmit mondana. Egy hianyos dupla igy a POZITIV agat pirosra dontene --
      es a piros nem a jogosultsagrol szolna, hanem a duplarol.
    */
    versions: [
      {
        id: "version-1",
        worksheetId: SAJAT_LAP_ID,
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
        createdAt: KELT,
        updatedAt: KELT,
        closedAt: null,
        closedById: null,
        createdBy: { displayName: "Szerelő Sándor" },
        closedBy: null,
        signature: null,
        lines: [],
      },
    ],
    signatures: [],
    lines: [],
    serviceJobId: null,
    serviceJob: null,
  };
}

describe("partneri munkalap-aláírás", () => {
  it("a partner nem tudja aláírni másik partner munkalapját", async () => {
    let signCalled = false;
    const repository = {
      detail: async () => null,
      sign: async () => {
        signCalled = true;
        return { ok: true };
      },
    } as unknown as WorksheetsRepository;
    const service = new WorksheetsService(repository);

    await assert.rejects(
      () =>
        service.sign(
          "other-partner-sheet",
          { decision: "ACCEPTED", signerName: "Teszt aláíró" },
          PARTNER,
        ),
      (error: { status?: number }) => error.status === 404,
    );
    assert.equal(signCalled, false);
  });

  /**
   * A POZITIV KONTROLL: A SAJAT LAPJAT ALA TUDJA IRNI.
   *
   * === MIERT KELL, ES MIT NEM FOG MEG A NEGATIV AG ===
   *
   * A fenti allitas azt meri, hogy IDEGEN lapot nem ir ala. Az akkor is zold,
   * ha a szures TUL SZIGORU: ha a hatokor minden partner minden lapjat kizarna,
   * minden partner hibauzenetet kapna alairaskor, es EGYETLEN teszt sem
   * pirosodna. A tiltas merese onmagaban nem mondja meg, hogy a MEGENGEDETT ut
   * jarhato-e.
   *
   * === ES A HATOKOR IS MERVE VAN, NEM CSAK AZ, HOGY ATMENT ===
   *
   * A `detail` KETSZER hivodik: eloszor a KERO hatokorevel (a szures), majd a
   * sikeres iras utan BELSO hatokorrel (a valasz osszeallitasa). Az allitas az
   * ELSO hivast nezi: ha az belso hatokorrel menne, a szures ELTUNNE, es a
   * fenti negativ allitas... tovabbra is zold maradna, mert ott a dupla `null`-t
   * ad minden hatokorre. Ket allitas, ket kulon res.
   */
  it("a partner ALA TUDJA IRNI a sajat munkalapjat", async () => {
    const hatokorok: unknown[] = [];
    /*
      A TIPUS `Record`, ES NEM EGY SZUK ALAK. A TypeScript a `let x = null`
      valtozot a lezaraskor `never`-re szukiti, es a `signInput!.worksheetId`
      forditasi hibat ad -- nem a teszt hibas, hanem a szukites nem latja, hogy
      a dupla beleirt. A lenti `bemenet` sor ezt oldja fel egy helyen.
    */
    let signInput: Record<string, unknown> | null = null;
    const repository = {
      detail: async (_id: string, scope: unknown) => {
        hatokorok.push(scope);
        return sajatLap();
      },
      sign: async (input: Record<string, unknown>) => {
        signInput = input;
        return { ok: true } as const;
      },
    } as unknown as WorksheetsRepository;
    const service = new WorksheetsService(repository);

    await service.sign(
      SAJAT_LAP_ID,
      { decision: "ACCEPTED", signerName: "Teszt aláíró" },
      PARTNER,
    );

    assert.notEqual(
      signInput,
      null,
      "a sajat lap alairasa NEM jutott el a tarolohoz",
    );
    const bemenet = signInput as unknown as Record<string, unknown>;
    assert.equal(bemenet.worksheetId, SAJAT_LAP_ID);
    assert.equal(bemenet.signerName, "Teszt aláíró");

    // AZ ELSO LEKERDEZES A KERO HATOKOREVEL MEGY, nem belsovel.
    assert.deepEqual(hatokorok[0], {
      kind: "customer",
      customerId: "customer-a",
    });
  });
});
