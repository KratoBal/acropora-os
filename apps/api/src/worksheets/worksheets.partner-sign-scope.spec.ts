import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import type { WorksheetsRepository } from "./worksheets.repository.js";
import { WorksheetsService } from "./worksheets.service.js";
import { hashPassword } from "../users/password.util.js";

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
    /*
      A HIBAJEGY 2026-09-21 OTA ELOFELTETELE AZ ALAIRASNAK (Balazs 5. szabalya).
      Ez a ket mezo MAR ITT ALLT, `null` ertekkel: a dupla egy olyan vilagot irt
      le, ami azota tiltott. A partner NEM tud jegyet nyitni, tehat null mellett
      a partneri ag egy olyan mondaton allna meg, amire neki nincs teendoje --
      es a piros nem a hatokorrol szolna, hanem a hianyzo jegyrol.
    */
    serviceJobId: "job-1",
    serviceJob: { id: "job-1", jobNumber: "HJ-2026-001" },
  };
}

/**
 * A KALIBRÁCIÓ NYOMA (nautilus, 2026-09-18 10:0x) -- MÉRVE, NEM ÁLLÍTVA.
 *
 * === MIÉRT ÁLL ITT, ÉS MIÉRT NEM ELÉG A ZÖLD ===
 *
 * Ez a két állítás 2026-09-17-én íródott, és a kalibrációjának SEHOL nem volt
 * nyoma: sem itt, sem a kártyán. A hiány nem azt jelentette, hogy nem futott le
 * -- azt, hogy a két esetet nem lehetett megkülönböztetni. Egy őrző, amit senki
 * nem látott bukni, kívülről ugyanúgy néz ki, mint egy díszlet.
 *
 * === A KÉT RONTÁS ÉS AZ EREDMÉNYÜK ===
 *
 *   az első lekérdezés BELSŐS hatókörrel megy
 *     (`requireWorksheet(id, { kind: "internal" })`)
 *       -> a POZITÍV állítás piros, a negatív ZÖLD
 *
 *   a kapu dobása elnyelve (a hívás megmarad, csak az eredménye közömbös)
 *       -> a NEGATÍV állítás piros, a pozitív ZÖLD
 *
 * MINDKETTŐ PONTOSAN EGYET DÖNT PIROSRA, és a másikat zölden hagyja. EZ a
 * bizonyíték, nem a piros maga: ha mindkét rontásra mindkettő pirosodna, a pár
 * nem különböztetne, és akkor a SPEC szorulna javításra, nem a kód.
 *
 * === EGY BUKTATÓ A RONTÁS ALAKJÁRÓL, HOGY A KÖVETKEZŐ NE FUSSON BELE ===
 *
 * Az első változatom a `scope` változót ÁRVÁN hagyta (`TS6133`), és a fordító
 * megállt. A teszt akkor is adott eredményt -- de az egy BUKOTT FORDÍTÁS melletti
 * futás volt, nem mérés. A helyes alak a nevet HASZNÁLATBAN tartja:
 *
 *   scope.kind === "internal" ? scope : { kind: "internal" as const }
 *
 * Visszaállítás után `diff` bájtra azonos, és a készlet 2/2 zöld.
 */
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
   * === A BEMENETE 2026-09-21-EN MEGVALTOZOTT, ES EZ NEM A TESZT GYENGITESE ===
   *
   * Ez az allitas korabban SZABAD SZOVEGES nevvel irt ala (`signerName: "Teszt
   * alairo"`), mert akkor az volt a legrovidebb ut a POZITIV ag bejarasahoz.
   * Azt az agat a 9188d799 LEZARTA kulsos keronek: Balazs merese szerint
   * "minden kulsos partner csak a sajat neveben irhat ala", a szabad szoveges
   * ag pedig barmilyen nevet a lapra tett volna, ALAIROKOD NELKUL.
   *
   * AMIT EZ A TESZT MER, VALTOZATLAN: hogy a partner a SAJAT lapjat ala tudja
   * irni, es hogy az ELSO lekerdezes a KERO hatokorevel megy. Csak a bemenet
   * kerult at a ma is megengedett utra (sajat azonosito a listarol, plusz
   * alairokod) -- vagyis a teszt ma a VALODI portal-utat jarja be, nem egy
   * rovidebbet.
   *
   * A KULONBSEG KIMONDVA: a regi alak azt allitotta, hogy a partner BARMILYEN
   * nevvel alairhat; az uj azt, hogy a SAJATJAVAL. Ha valaki a jovoben ezt a
   * bemenetet "egyszerusiti" vissza szabad szovegre, a szolgaltatas elutasitja
   * -- es ez a bekezdes mondja meg, miert.
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
      /*
        A KET UJ DUPLA 2026-09-21 OTA KELL, es a bemenet valtozasa miatt --
        lasd a teszt fejlecet. A partner mostantol a LISTAROL valasztja ki
        magat es kodot ad, tehat a szolgaltatas ezt a ket varratot hasznalja.
        A hash ugyanabbol a fuggvenybol jon, amit a valodi kod hasznal: egy
        kezzel kitalalt "hash" sosem egyezne, es a teszt rossz okbol lenne zold.
      */
      customerContacts: async () => [{ id: PARTNER.id, name: "Partner Petra" }],
      signingCodeHash: async () => await hashPassword("0000"),
      sign: async (input: Record<string, unknown>) => {
        signInput = input;
        return { ok: true } as const;
      },
    } as unknown as WorksheetsRepository;
    const service = new WorksheetsService(repository);

    await service.sign(
      SAJAT_LAP_ID,
      {
        decision: "ACCEPTED",
        signerUserId: PARTNER.id,
        signatureCode: "0000",
      } as never,
      PARTNER,
    );

    assert.notEqual(
      signInput,
      null,
      "a sajat lap alairasa NEM jutott el a tarolohoz",
    );
    const bemenet = signInput as unknown as Record<string, unknown>;
    assert.equal(bemenet.worksheetId, SAJAT_LAP_ID);
    assert.equal(bemenet.signerName, "Partner Petra");

    // AZ ELSO LEKERDEZES A KERO HATOKOREVEL MEGY, nem belsovel.
    assert.deepEqual(hatokorok[0], {
      kind: "customer",
      customerId: "customer-a",
    });
  });
});
