import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsController } from "./service-jobs.controller.js";
import { ServiceJobsService } from "./service-jobs.service.js";
import { mayWriteServiceJob } from "./service-job-write-scope.js";

/**
 * A HIBAJEGY IRASI UTJAI A HIVO HATOKORET NEZIK -- AZ IRAS ELOTT.
 *
 * === MI VOLT A RES, ES MIERT NEM A VALASZKOD MERI ===
 *
 * 2026-09-14-ig az ot irasi ut (`move`, `attachWorksheet`, `detachWorksheet`,
 * `setPartner`, `setAssignees`) SEMMILYEN hatokort nem nezett. A
 * `visibilityFor` a szolgaltatasban pontosan KET helyen hivodott: a listanal es
 * a reszletlapnal -- vagyis csak az OLVASAS szurt.
 *
 * A `setAssignees` adott ugyan 404-et egy partner-hatokoru hivonak, DE KESON:
 * az iras a tranzakcioban MAR megtortent, es a hatokor csak a valasz
 * osszeallitasakor szolalt meg (`this.detail(id, user)`). A hivo 404-et latott,
 * a valtozas bent maradt.
 *
 * EZERT NEM A VALASZKODRA ALL AZ ALLITAS, HANEM A TAROLORA. Egy 404-et mero
 * teszt a RES FENNALLASA MELLETT IS ZOLD lett volna -- pontosan azt a hibat
 * hitelesitette volna, amit meg akar fogni.
 *
 * === A KONTROLL, AMI NELKUL EZ A FAJL DISZLET LENNE ===
 *
 * Minden uthoz tartozik egy BELSOS eset is, ami megmutatja, hogy a tarolo
 * HIVODIK. Enelkul egy elrontott hamis tarolo (ami sosem hiv) ugyanezt a zoldet
 * adna, es a fajl azt allitana, hogy ved valamit.
 */

const BELSOS = { id: "user-1" } as AuthenticatedUser;
/** A partner-hatokort a felhasznaloi soron allo azonosito adja, nem a szerep. */
const VEVO = { id: "user-2", customerId: "vevo-1" } as AuthenticatedUser;
const SZALLITO = { id: "user-3", supplierId: "sup-1" } as AuthenticatedUser;

type DetailRow = Awaited<ReturnType<ServiceJobsRepository["detail"]>>;

/**
 * A LEGSZUKEBB RESZLETLAP-SOR, TIPUSOSAN.
 *
 * A `setAssignees` a valaszahoz a TELJES reszletlapot allitja ossze, tehat a
 * kontrolljanak kell egy sor. `as unknown as` NELKUL: a varrat valodi tipusa
 * epp az az egy ellenorzes, amit egy kenyelmi cast kikapcsolna.
 */
const RESZLETLAP: DetailRow = {
  // A helyszin UTJA tovabbra is `null` maradhat: ezt a mezot egyik allitas
  // sem meri itt, a `departmentId` mostantol kotelezo (lasd lent).
  departmentPath: null,
  id: "job-1",
  jobNumber: "HJ-2026-001",
  previousNumber: null,
  kind: "REPAIR",
  title: "Szivattyú leállt",
  description: null,
  reporterPersonName: null,
  openedById: null,
  status: "NEW",
  createdAt: new Date("2026-09-01T08:00:00.000Z"),
  scheduledAt: null,
  hiddenAt: null,
  startedAt: null,
  completedAt: null,
  customerId: "vevo-1",
  customer: { displayName: "Fővárosi Állat- És Növénykert" },
  // MOSTANTOL VALOS ERTEK, NEM `null`: a `departmentId` a
  // `20260924180000_department_required` migracio (Balazs dontese, "1
  // legyen kotelezo") ota kotelezo. Ez a fajl az IRASI HATOKORT meri
  // (move, attachWorksheet, setPartner stb.), egyetlen allitas sem a
  // helyszinrol szol -- az ertek csak azert kell, hogy a `DetailRow`
  // tipusnak megfelelo legyen.
  departmentId: "unit-1",
  department: { name: "Biodóm", code: "BIO", parent: null },
  events: [],
  worksheets: [],
  assets: [],
  assignees: [],
  contract: null,
  maintenanceOrder: null,
  contractItems: [],
};

/** Amit a tarolo OLDALAN latunk: minden iro metodus nevet feljegyzi. */
function serviceWith(overrides: Partial<ServiceJobsRepository> = {}) {
  const irasok: string[] = [];
  const repository: Partial<ServiceJobsRepository> = {
    detail: async () => RESZLETLAP,
    documentRemovals: async () => [],
    statusOf: async () => "NEW",
    // a karbantartás-őr a vezérlő belépőin a jegy fajtáját olvassa (maintenance-guard.ts); alapból javítás
    kindOf: async () => "REPAIR",
    setHidden: async () => {
      irasok.push("setHidden");
    },
    jobAttachState: async () => ({ customerId: "vevo-1" }),
    worksheetAttachState: async () => ({
      serviceJobId: null,
      customerId: "vevo-1",
    }),
    customerExists: async () => true,
    assignableUserIds: async (ids: readonly string[]) => new Set(ids),
    move: async () => {
      irasok.push("move");
      return { ok: true };
    },
    attachWorksheet: async () => {
      irasok.push("attachWorksheet");
      return { ok: true };
    },
    detachWorksheet: async () => {
      irasok.push("detachWorksheet");
      return { ok: true };
    },
    setPartner: async () => {
      irasok.push("setPartner");
      return { ok: true };
    },
    setAssignees: async () => {
      irasok.push("setAssignees");
      return { ok: true, added: [] };
    },
    // A HELYSZIN-ES-ESZKOZ UT SAJAT ELOFELTETELEI: a helyszin a jegy
    // partnereé, es a bekuldott eszkozok a reszfajan allnak. Enelkul a
    // KONTROLL (belsos hivo) a sajat ellenorzesein hasalna el, es a pirosa nem
    // a hatokorrol szolna.
    departmentBelongsToCustomer: async () => true,
    assetsOutsideDepartment: async () => [],
    /*
      A HIVO MOSTANTOL LEKERDEZI A JEGYHEZ KOTOTT LAPOKAT IS (a helyszin
      atvezetesehez). A varrat laza (`as unknown as`), tehat a hianyzo metodusrol
      a fordito nem szol -- a szolgaltatas viszont HASZNALJA. Ures lista: ezek az
      esetek nem lapokrol szolnak.
    */
    worksheetsForPlacement: async () => [],
    setPlacement: async () => {
      irasok.push("setPlacement");
      return true;
    },
    ...overrides,
  } as unknown as Partial<ServiceJobsRepository>;
  return {
    service: new ServiceJobsService(repository as ServiceJobsRepository),
    irasok,
  };
}

/** Az ot ut, egy helyen: a lista ITT all, hogy egy uj ut felvetele latszodjon. */
const UTAK: {
  nev: string;
  hivas: (
    service: ServiceJobsService,
    user: AuthenticatedUser,
  ) => Promise<unknown>;
  /**
   * AMI AZ ADOTT UT SAJAT ELOFELTETELE. A hatokor-allitasoknak nem kell (ott a
   * keres el sem jut idaig), a KONTROLLNAK viszont igen: enelkul a belsos eset
   * a sajat utkozes-ellenorzesen hasalna el, es a kontroll pirosa nem a
   * hatokorrol szolna.
   */
  elofeltetel?: Partial<ServiceJobsRepository>;
}[] = [
  {
    nev: "move",
    hivas: (service, user) =>
      service.move("job-1", { to: "TRIAGED" }, user.id, user),
  },
  {
    nev: "attachWorksheet",
    hivas: (service, user) =>
      service.attachWorksheet("job-1", "worksheet-1", user),
  },
  {
    // A LEVALASZTAS csak akkor megy, ha a lap TENYLEG ezen a jegyen all.
    elofeltetel: {
      worksheetAttachState: async () => ({
        serviceJobId: "job-1",
        customerId: "vevo-1",
      }),
    },
    nev: "detachWorksheet",
    hivas: (service, user) =>
      service.detachWorksheet("job-1", "worksheet-1", user),
  },
  {
    // A PARTNER POTLASA csak partner NELKULI jegyen megy: egy mar meglevo
    // partner atirasa atsorolas lenne, es arra ma nincs ut.
    elofeltetel: { jobAttachState: async () => ({ customerId: null }) },
    nev: "setPartner",
    hivas: (service, user) => service.setPartner("job-1", "vevo-2", user),
  },
  {
    nev: "setAssignees",
    hivas: (service, user) =>
      service.setAssignees("job-1", { userIds: [] }, user),
  },
  {
    nev: "setPlacement",
    hivas: (service, user) =>
      service.setPlacement(
        "job-1",
        { departmentId: "unit-9", assetIds: [] },
        user,
      ),
  },
];

describe("a hibajegy írási útjai és a hívó hatóköre", () => {
  for (const ut of UTAK) {
    it(`${ut.nev}: vevő-hatókörnél NEM ír, és 404-et ad`, async () => {
      const { service, irasok } = serviceWith(ut.elofeltetel);

      await assert.rejects(
        () => ut.hivas(service, VEVO),
        (hiba: { status?: number }) => hiba.status === 404,
      );
      // EZ A LENYEG, NEM A 404: a tarolohoz el sem jutott a keres.
      assert.deepEqual(irasok, []);
    });

    it(`${ut.nev}: szállító-hatókörnél sem ír`, async () => {
      const { service, irasok } = serviceWith(ut.elofeltetel);

      await assert.rejects(() => ut.hivas(service, SZALLITO));
      assert.deepEqual(irasok, []);
    });

    /**
     * A KONTROLL. Enelkul a fenti ket allitas akkor is zold lenne, ha a hamis
     * tarolo SOHA nem hivna -- vagyis ha a mero maga romlott el.
     */
    it(`${ut.nev}: belsős hívónál a tároló MEGKAPJA az írást`, async () => {
      const { service, irasok } = serviceWith(ut.elofeltetel);

      await ut.hivas(service, BELSOS);

      assert.deepEqual(irasok, [ut.nev]);
    });
  }
});

/**
 * ES UGYANEZ A VALODI KONTROLLEREN AT.
 *
 * === MIERT KELL, HA A SZOLGALTATAS MAR MERVE VAN ===
 *
 * A fenti allitasok a szolgaltatast hivjak kozvetlenul. Az a DONTEST meri (nem
 * ir), de NEM azt, hogy a hivo hatokore egyaltalan ELJUT-e odaig. Harom
 * vegpontnak (`setPartner`, `attachWorksheet`, `detachWorksheet`) 2026-09-14-ig
 * NEM VOLT `user` parametere -- a kontroller nem is adta at. Egy szabaly, ami
 * all, de nincs bekotve, ugyanolyan nema, mint a hianya.
 *
 * === AMIT EZ NEM POTOL ===
 *
 * Ez NEM adatbazis-szintu integracios meres: a tarolo tovabbra is hamis. Amit
 * bizonyit, az a LANC a kontrollertol a tarolo hataraig. A valodi
 * adatbazison futo valtozat kulon tetel, es ebben a konteneben nem is
 * futtathato (nincs postgres).
 */
describe("a kontroller atadja a hivot, es a partner igy sem ir", () => {
  const KONTROLLER_UTAK: {
    nev: string;
    hivas: (
      controller: ServiceJobsController,
      user: AuthenticatedUser,
    ) => Promise<unknown>;
    elofeltetel?: Partial<ServiceJobsRepository>;
  }[] = [
    {
      nev: "move",
      hivas: (controller, user) =>
        controller.move("job-1", { to: "TRIAGED" }, user) as Promise<unknown>,
    },
    {
      nev: "attachWorksheet",
      hivas: (controller, user) =>
        controller.attachWorksheet(
          "job-1",
          { worksheetId: "worksheet-1" },
          user,
        ) as Promise<unknown>,
    },
    {
      nev: "detachWorksheet",
      elofeltetel: {
        worksheetAttachState: async () => ({
          serviceJobId: "job-1",
          customerId: "vevo-1",
        }),
      },
      hivas: (controller, user) =>
        controller.detachWorksheet(
          "job-1",
          "worksheet-1",
          user,
        ) as Promise<unknown>,
    },
    {
      nev: "setPartner",
      elofeltetel: { jobAttachState: async () => ({ customerId: null }) },
      hivas: (controller, user) =>
        controller.setPartner(
          "job-1",
          { customerId: "vevo-2" },
          user,
        ) as Promise<unknown>,
    },
    {
      nev: "setAssignees",
      hivas: (controller, user) =>
        controller.setAssignees(
          "job-1",
          { userIds: [] },
          user,
        ) as Promise<unknown>,
    },
    {
      nev: "setPlacement",
      hivas: (controller, user) =>
        controller.setPlacement(
          "job-1",
          { departmentId: "unit-9", assetIds: [] },
          user,
        ) as Promise<unknown>,
    },
  ];

  for (const ut of KONTROLLER_UTAK) {
    it(`${ut.nev}: a kontrolleren át sem ír vevő-hatókörnél`, async () => {
      const { service, irasok } = serviceWith(ut.elofeltetel);
      const controller = new ServiceJobsController(service, {
        download: async () => undefined,
      } as never);

      await assert.rejects(
        () => ut.hivas(controller, VEVO),
        (hiba: { status?: number }) => hiba.status === 404,
      );
      assert.deepEqual(irasok, []);
    });

    /** A KONTROLL: belsos hivonal a lanc VEGIG megy, a taroloig. */
    it(`${ut.nev}: belsős hívónál a kontrolleren át is ír`, async () => {
      const { service, irasok } = serviceWith(ut.elofeltetel);
      const controller = new ServiceJobsController(service, {
        download: async () => undefined,
      } as never);

      await ut.hivas(controller, BELSOS);

      assert.deepEqual(irasok, [ut.nev]);
    });
  }
});

/**
 * A SZABALY MAGA, A SZOLGALTATAS NELKUL.
 *
 * Kulon all, mert a fenti allitasok a BEKOTEST merik (eljut-e a dontes az iras
 * ele), ez pedig a DONTEST. A ketto kulon romolhat el.
 */
describe("ki írhat egy hibajegyet", () => {
  it("a belsős igen", () => {
    assert.equal(mayWriteServiceJob({ kind: "internal" }), true);
  });

  it("a vevő nem", () => {
    assert.equal(
      mayWriteServiceJob({ kind: "customer", customerId: "vevo-1" }),
      false,
    );
  });

  it("a szállító sem", () => {
    assert.equal(
      mayWriteServiceJob({ kind: "supplier", supplierId: "sup-1" }),
      false,
    );
  });
});

/*
  A KARBANTARTÁSI JEGYEN NINCS HIBAJEGY-KEZELÉS, A SZERVER IS TARTJA (t-20261118-karbantartas-szerver-tiltas; Balázs, 2026-11-18 11:31
  UTC: a karbantartásnak nincs hibajegy-állapotgépe, az aláírt munkalap a kész). MI PIROSIT: egy tiltott belépő karbantartáson ír
  (a tároló megkapja); a javítási jegyen ugyanez nem ír (a kontroll); az elrejtés visszavonása vagy a rendszer belső lemondása
  (`MaintenanceOrdersService` -> `service.move`) karbantartáson elakad; a partner-hatókör a 404 helyett 409-et kap (a tiltás többet
  árulna el a jegyről, mint a művelet).
*/
describe("a karbantartási jegy tiltott belépői a szerveren", () => {
  const KARBANTARTAS: Partial<ServiceJobsRepository> = {
    kindOf: async () => "MAINTENANCE",
  };
  const controllerOf = (overrides: Partial<ServiceJobsRepository>) => {
    const { service, irasok } = serviceWith(overrides);
    return {
      controller: new ServiceJobsController(service, {
        download: async () => undefined,
      } as never),
      service,
      irasok,
    };
  };
  const BELEPOK: {
    nev: string;
    elofeltetel?: Partial<ServiceJobsRepository>;
    hivas: (c: ServiceJobsController, u: AuthenticatedUser) => Promise<unknown>;
  }[] = [
    {
      nev: "move",
      hivas: (c, u) =>
        c.move("job-1", { to: "TRIAGED" }, u) as Promise<unknown>,
    },
    {
      nev: "attachWorksheet",
      hivas: (c, u) =>
        c.attachWorksheet(
          "job-1",
          { worksheetId: "worksheet-1" },
          u,
        ) as Promise<unknown>,
    },
    {
      nev: "detachWorksheet",
      elofeltetel: {
        worksheetAttachState: async () => ({
          serviceJobId: "job-1",
          customerId: "vevo-1",
        }),
      },
      hivas: (c, u) =>
        c.detachWorksheet("job-1", "worksheet-1", u) as Promise<unknown>,
    },
    {
      nev: "setPartner",
      elofeltetel: { jobAttachState: async () => ({ customerId: null }) },
      hivas: (c, u) =>
        c.setPartner("job-1", { customerId: "vevo-2" }, u) as Promise<unknown>,
    },
    {
      nev: "setHidden",
      hivas: (c, u) =>
        c.setHidden("job-1", { hidden: true }, u) as Promise<unknown>,
    },
  ];
  const ADMIN = {
    id: "user-1",
    permissions: ["service.hide"],
  } as unknown as AuthenticatedUser;

  for (const b of BELEPOK) {
    it(`${b.nev}: karbantartáson 409, és a tároló nem kap írást`, async () => {
      const { controller, irasok } = controllerOf({
        ...b.elofeltetel,
        ...KARBANTARTAS,
      });
      await assert.rejects(
        () => b.hivas(controller, ADMIN),
        (hiba: { status?: number; message?: string }) =>
          hiba.status === 409 &&
          /Karbantartási munkán nincs/.test(hiba.message ?? ""),
      );
      assert.deepEqual(irasok, []);
    });

    it(`${b.nev}: javítási jegyen ír (a kontroll)`, async () => {
      const { controller, irasok } = controllerOf({ ...b.elofeltetel });
      await b.hivas(controller, ADMIN);
      assert.deepEqual(irasok, [b.nev]);
    });

    it(`${b.nev}: a partner-hatókör karbantartáson is 404-et kap, nem 409-et`, async () => {
      const { controller, irasok } = controllerOf({
        ...b.elofeltetel,
        ...KARBANTARTAS,
      });
      await assert.rejects(
        () => b.hivas(controller, VEVO),
        (hiba: { status?: number }) => hiba.status === 404,
      );
      assert.deepEqual(irasok, []);
    });
  }

  it("az elrejtés VISSZAVONÁSA karbantartáson is megy: egy elrejtett lap ne ragadjon be", async () => {
    const { controller, irasok } = controllerOf(KARBANTARTAS);
    await controller.setHidden("job-1", { hidden: false }, ADMIN);
    assert.deepEqual(irasok, ["setHidden"]);
  });

  it("a rendszer belső lemondása (service.move, a MaintenanceOrdersService útja) karbantartáson is lefut", async () => {
    // a lemondás a jegy alatti lapok aláírását is nézi; itt nincs lap
    const { service, irasok } = controllerOf({
      ...KARBANTARTAS,
      worksheetSignatureStates: async () => [],
    });
    await service.move("job-1", { to: "CANCELLED" }, "user-1", ADMIN);
    assert.deepEqual(irasok, ["move"]);
  });

  it("nem létező jegyre 404, nem 409", async () => {
    const { controller, irasok } = controllerOf({ kindOf: async () => null });
    await assert.rejects(
      () =>
        controller.move("nincs", { to: "TRIAGED" }, ADMIN) as Promise<unknown>,
      (hiba: { status?: number }) => hiba.status === 404,
    );
    assert.deepEqual(irasok, []);
  });
});
