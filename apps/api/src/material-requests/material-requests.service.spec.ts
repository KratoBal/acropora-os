import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ForbiddenException, ConflictException } from "@nestjs/common";

import type { MaterialRequestsRepository } from "./material-requests.repository.js";
import { MaterialRequestsService } from "./material-requests.service.js";

/**
 * A KERO, BELSOS HATOKORREL -- UGYANAZ A FIXTURA, MINT A MUNKANAPLONAL
 * (`worksheet-entries.service.spec.ts`), ugyanazon okbol: a vegpontok
 * belsos-only kapun mennek at, es egy partner alaku kero eseten a teszt MAR
 * OTT elbukna.
 */
const belsos = (id: string) =>
  ({ id, customerId: null, supplierId: null }) as never;
const partner = (id: string) =>
  ({ id, customerId: "customer-1", supplierId: null }) as never;

const CREATED = new Date("2026-09-22T20:00:00.000Z");

const WORKSHEET = {
  id: "worksheet-1",
  number: "BIO-2026-001",
  customer: { id: "customer-1", displayName: "Kovács Kft." },
  assignees: [
    { userId: "assignee-1", name: "Szerelő Elek", assignedAt: "2026-09-01" },
    { userId: "assignee-2", name: "Szerelő Feri", assignedAt: "2026-09-02" },
  ],
};

const DRAFT_ROW = {
  id: "mr-1",
  worksheetId: "worksheet-1",
  status: "DRAFT" as const,
  requestedById: "kero-1",
  requestedByName: "Szerelő Sándor",
  createdAt: CREATED,
  submittedAt: null,
  receivedAt: null,
  receivedByName: null,
  items: [{ id: "item-1", name: "40mm könyök", quantity: "2", unit: "db" }],
};

/** A `receive()` tesztek alapallapota: mar elkuldve, meg nem beerkezve. */
const REQUEST_ROW = {
  ...DRAFT_ROW,
  status: "OPEN" as const,
  submittedAt: CREATED,
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    create: async () => DRAFT_ROW,
    submit: async () => REQUEST_ROW,
    listForWorksheet: async () => [REQUEST_ROW],
    detail: async () => REQUEST_ROW,
    listPending: async () => [
      {
        ...REQUEST_ROW,
        worksheetNumber: "BIO-2026-001",
        customerDisplayName: "Kovács Kft.",
        departmentName: "Biodom",
      },
    ],
    markReceived: async () => ({
      ...REQUEST_ROW,
      status: "RECEIVED" as const,
      receivedAt: CREATED,
      receivedByName: "Beszerző Béla",
    }),
    notificationRecipients: async () => [
      {
        id: "notif-1",
        email: "notif@example.invalid",
        displayName: "Ért. Erika",
      },
    ],
    hasMarkReceivedCapability: async () => true,
    anyActiveMarkReceivedCapabilityHolder: async () => true,
    activeUsersByIds: async (ids: readonly string[]) =>
      ids.map((id) => ({
        id,
        email: `${id}@example.invalid`,
        displayName: id,
      })),
    ...overrides,
  } as unknown as MaterialRequestsRepository;
}

function worksheetsService(overrides: Record<string, unknown> = {}) {
  return {
    detail: async () => WORKSHEET,
    ...overrides,
  } as never;
}

function notificationsService() {
  const hivasok: unknown[] = [];
  return {
    service: {
      notifyMaterialRequestCreated: (input: unknown) =>
        hivasok.push(["created", input]),
      notifyMaterialRequestReceived: (input: unknown) =>
        hivasok.push(["received", input]),
    } as never,
    hivasok,
  };
}

function ticketMailService() {
  const hivasok: unknown[] = [];
  return {
    service: {
      notifyMaterialRequestCreated: (input: unknown) =>
        hivasok.push(["created", input]),
      notifyMaterialRequestReceived: (input: unknown) =>
        hivasok.push(["received", input]),
    } as never,
    hivasok,
  };
}

function service(input: {
  repo?: Record<string, unknown>;
  worksheets?: Record<string, unknown>;
}) {
  const notifications = notificationsService();
  const ticketMail = ticketMailService();
  return {
    service: new MaterialRequestsService(
      repository(input.repo),
      worksheetsService(input.worksheets),
      notifications.service,
      ticketMail.service,
      {} as NodeJS.ProcessEnv,
    ),
    push: notifications.hivasok,
    mail: ticketMail.hivasok,
  };
}

describe("anyagigény felvitele (piszkozat)", () => {
  it("partner nem küldhet -- a belsős kapu megállítja", async () => {
    const { service: s } = service({});
    await assert.rejects(
      s.create("worksheet-1", { items: [] } as never, partner("kero-1")),
      ForbiddenException,
    );
  });

  it("sikeres felvitel DRAFT állapotú sort ad, tételekkel", async () => {
    /*
      A `create` AZ UJ SORT ADJA, NEM A TELJES LISTAT -- lasd a szerver
      metodus fejlecet: a hivonak azonnal kell az azonosito a `submit`-hez,
      es egy UJ sornal a "stale lista" veszely nem all fenn.
    */
    const { service: s } = service({});
    const out = await s.create(
      "worksheet-1",
      { items: [{ name: "40mm könyök", quantity: "2", unit: "db" }] },
      belsos("kero-1"),
    );
    assert.equal(out.id, "mr-1");
    assert.equal(out.status, "DRAFT");
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0]?.name, "40mm könyök");
  });

  it("felvitelkor MÉG nem megy értesítés -- csak a küldés indítja", async () => {
    /*
      EZ A FO KULONBSEG A JAVITAS ELOTTI ES UTANI ALAK KOZOTT. acrobot
      kikotese, 2026-09-22 22:52:23 UTC: a letrehozas es a kuldes KET KULON
      muvelet, es CSAK a masodik indit ertesitest.
    */
    const { service: s, push, mail } = service({});
    await s.create(
      "worksheet-1",
      { items: [{ name: "40mm könyök", quantity: "2", unit: "db" }] },
      belsos("kero-1"),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(push.length, 0);
    assert.equal(mail.length, 0);
  });
});

describe("anyagigény elküldése", () => {
  it("partner nem küldheti el -- a belsős kapu megállítja", async () => {
    const { service: s } = service({});
    await assert.rejects(
      s.submit("mr-1", partner("kero-1")),
      ForbiddenException,
    );
  });

  it("MÁS piszkozatát nem küldheti el -- tulajdon kérdése, nem csak jog", async () => {
    const { service: s } = service({
      repo: { detail: async () => DRAFT_ROW },
    });
    await assert.rejects(
      s.submit("mr-1", belsos("masik-szerelo")),
      ForbiddenException,
    );
  });

  it("nem létező igényre ConflictException", async () => {
    const { service: s } = service({ repo: { detail: async () => null } });
    await assert.rejects(s.submit("mr-x", belsos("kero-1")), ConflictException);
  });

  it("már elküldött (nem DRAFT) igényt nem lehet újra elküldeni", async () => {
    const { service: s } = service({
      repo: { detail: async () => REQUEST_ROW }, // status: OPEN
    });
    await assert.rejects(s.submit("mr-1", belsos("kero-1")), ConflictException);
  });

  it("sikeres küldés után a szerep-birtokosok kapnak push-t ÉS levelet is", async () => {
    const {
      service: s,
      push,
      mail,
    } = service({
      repo: { detail: async () => DRAFT_ROW },
    });
    const out = await s.submit("mr-1", belsos("kero-1"));
    assert.equal(out.items[0]?.status, "OPEN");

    /*
      A FIRE-AND-FORGET MIATT egy mikrofeladat-korre kell varni, mielott a
      hivas-listat ellenorizzuk.
    */
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(push.length, 1);
    assert.equal(mail.length, 1);
  });

  it("ha senkinél nincs bejelölve a szerep, egyik út sem indul", async () => {
    const {
      service: s,
      push,
      mail,
    } = service({
      repo: {
        detail: async () => DRAFT_ROW,
        notificationRecipients: async () => [],
      },
    });
    await s.submit("mr-1", belsos("kero-1"));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(push.length, 0);
    assert.equal(mail.length, 0);
  });

  it("egy ertesitesi hiba nem dobja tovabb -- a kuldott igeny akkor is visszaer", async () => {
    const { service: s } = service({
      repo: {
        detail: async () => DRAFT_ROW,
        notificationRecipients: async () => {
          throw new Error("kapcsolat megszakadt");
        },
      },
    });
    const out = await s.submit("mr-1", belsos("kero-1"));
    assert.equal(out.items[0]?.id, "mr-1");
    assert.equal(out.items[0]?.status, "OPEN");
  });

  /**
   * A `warning` MEZO -- Balazs kerese, 2026-09-22 20:28:56 UTC, acrobot
   * dontese a helyerol (2026-09-23). KULON CSALAD az ertesitesi szereptol:
   * az elozo ket teszt a PUSH/LEVEL utat meri (van-e cimzett), ez a mezo
   * pedig a BEERKEZES-JELOLES kepesseget -- a ketto fuggetlen egymastol.
   */
  it("ha van, aki jelölheti a beérkezést, a válasz NEM hordoz figyelmeztetést", async () => {
    const { service: s } = service({
      repo: { detail: async () => DRAFT_ROW },
    });
    const out = await s.submit("mr-1", belsos("kero-1"));
    assert.equal(out.warning, undefined);
  });

  it("ha SENKINÉL nincs bejelölve a beérkezés-jelölés joga, a válasz figyelmeztet -- de a küldés sikeres marad", async () => {
    const { service: s } = service({
      repo: {
        detail: async () => DRAFT_ROW,
        anyActiveMarkReceivedCapabilityHolder: async () => false,
      },
    });
    const out = await s.submit("mr-1", belsos("kero-1"));
    // A KULDES NEM AKADALYOZOTT: az igeny akkor is letrejott, elkuldve.
    assert.equal(out.items[0]?.status, "OPEN");
    assert.ok(
      out.warning,
      "a válasznak figyelmeztetést kellett volna hordoznia",
    );
    assert.match(out.warning ?? "", /senki nem tudja megjelölni/);
  });
});

describe("anyagigények listája munkalaponként", () => {
  it("partner nem lathatja -- belsos kapu", async () => {
    const { service: s } = service({});
    await assert.rejects(
      s.listForWorksheet("worksheet-1", partner("kero-1")),
      ForbiddenException,
    );
  });

  it("belsős kolléga látja", async () => {
    const { service: s } = service({});
    const out = await s.listForWorksheet("worksheet-1", belsos("kero-1"));
    assert.equal(out.items.length, 1);
  });

  /**
   * A SZAMLALO LEKERDEZES NE FUSSON FELESLEGESEN (acrobot kikotese,
   * 2026-09-23): a `anyActiveMarkReceivedCapabilityHolder` KIZAROLAG a
   * `submit()` agaban fusson. Ha ez a listazas is hivna, a dobo csonk itt
   * pirosra vinne a tesztet.
   */
  it("a beérkezés-jelölő számláló NEM fut a listázásban", async () => {
    const { service: s } = service({
      repo: {
        anyActiveMarkReceivedCapabilityHolder: async () => {
          throw new Error("nem lett volna szabad meghívni");
        },
      },
    });
    await s.listForWorksheet("worksheet-1", belsos("kero-1"));
  });
});

describe("a beszerző saját listája", () => {
  it("a jog nélküli belsős kolléga elutasítást kap, NEM üres listát", async () => {
    /*
      A KULONBSEG FONTOS: egy ures lista ugy nezne ki, mintha nem lenne
      teendo. Az elutasitas kimondja, hogy a jog hianyzik -- lasd a
      `MaterialRequestsService.listPending` fejlecet.
    */
    const { service: s } = service({
      repo: { hasMarkReceivedCapability: async () => false },
    });
    await assert.rejects(
      s.listPending(belsos("nem-beszerzo")),
      ForbiddenException,
    );
  });

  it("a jogosult kolléga megkapja a listát, munkalap-kontextussal", async () => {
    const { service: s } = service({});
    const out = await s.listPending(belsos("beszerzo-1"));
    assert.equal(out.items.length, 1);
    assert.equal(out.items[0]?.customerDisplayName, "Kovács Kft.");
  });

  /** A PARJA, LASD A `listForWorksheet` MELLETTI TESZT FEJLECET. */
  it("a beérkezés-jelölő számláló NEM fut a beszerzői listában sem", async () => {
    const { service: s } = service({
      repo: {
        anyActiveMarkReceivedCapabilityHolder: async () => {
          throw new Error("nem lett volna szabad meghívni");
        },
      },
    });
    await s.listPending(belsos("beszerzo-1"));
  });
});

describe("a beérkezés jelölése", () => {
  it("jog nélkül elutasítás", async () => {
    const { service: s } = service({
      repo: { hasMarkReceivedCapability: async () => false },
    });
    await assert.rejects(
      s.receive("mr-1", belsos("nem-beszerzo")),
      ForbiddenException,
    );
  });

  it("nem létező igényre ConflictException, nem csendes null", async () => {
    const { service: s } = service({ repo: { detail: async () => null } });
    await assert.rejects(
      s.receive("mr-x", belsos("beszerzo-1")),
      ConflictException,
    );
  });

  it("már beérkezettként jelölt igényre ConflictException", async () => {
    const { service: s } = service({
      repo: {
        detail: async () => ({ ...REQUEST_ROW, status: "RECEIVED" as const }),
      },
    });
    await assert.rejects(
      s.receive("mr-1", belsos("beszerzo-1")),
      ConflictException,
    );
  });

  it("még el sem küldött (DRAFT) igényre ConflictException, nem sikeres jelölés", async () => {
    const { service: s } = service({
      repo: { detail: async () => DRAFT_ROW },
    });
    await assert.rejects(
      s.receive("mr-1", belsos("beszerzo-1")),
      ConflictException,
    );
  });

  it("sikeres jelölés után a friss, RÁ VÁRÓ listát adja -- a jelölt sor már nem rajta", async () => {
    /*
      A VALASZ A TELJES "RAM VARO" LISTA, NEM AZ EGY SOR. A beerkeztetett
      igeny mar nem `OPEN`, tehat a `listPending` (ami csak `OPEN`-t ad) nem
      tartalmazza -- a repository fake ures listat ad vissza, ugyanugy, mint
      elesben tenne.
    */
    const {
      service: s,
      push,
      mail,
    } = service({
      repo: { listPending: async () => [] },
    });
    const out = await s.receive("mr-1", belsos("beszerzo-1"));
    assert.deepEqual(out.items, []);

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(push.length, 1);
    assert.equal(mail.length, 1);
    const [, pushInput] = push[0] as [string, { userIds: string[] }];
    /*
      HAROM EMBER: a kero (`kero-1`) PLUSZ a ket felelos
      (`assignee-1`, `assignee-2`) -- Balazs kifejezett kerese a TAGABB
      cimzettkorre.
    */
    assert.deepEqual([...pushInput.userIds].sort(), [
      "assignee-1",
      "assignee-2",
      "kero-1",
    ]);
  });

  it("ha a kérő egyben felelős is, csak egyszer szerepel a listán", async () => {
    const { service: s, push } = service({
      worksheets: {
        detail: async () => ({
          ...WORKSHEET,
          assignees: [
            {
              userId: "kero-1",
              name: "Szerelő Sándor",
              assignedAt: "2026-09-01",
            },
          ],
        }),
      },
    });
    await s.receive("mr-1", belsos("beszerzo-1"));
    await new Promise((resolve) => setImmediate(resolve));
    const [, pushInput] = push[0] as [string, { userIds: string[] }];
    assert.deepEqual(pushInput.userIds, ["kero-1"]);
  });

  /** A PARJA, LASD A `listForWorksheet` MELLETTI TESZT FEJLECET. */
  it("a beérkezés-jelölő számláló NEM fut a jelölés megadásakor sem", async () => {
    const { service: s } = service({
      repo: {
        anyActiveMarkReceivedCapabilityHolder: async () => {
          throw new Error("nem lett volna szabad meghívni");
        },
      },
    });
    await s.receive("mr-1", belsos("beszerzo-1"));
  });
});
