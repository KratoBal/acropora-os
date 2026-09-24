import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  isPartnerServiceJobDetail,
  type ServiceJobDetail,
  type ServiceJobPartnerDetail,
  type AuthenticatedUser,
} from "@acropora/types";

import type { NotificationsService } from "../notifications/notifications.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { ServiceJobsModule } from "./service-jobs.module.js";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import { ServiceJobsService } from "./service-jobs.service.js";

const BELSOS = { id: "user-1" } as AuthenticatedUser;
const CREATED_AT = new Date("2026-09-14T08:00:00.000Z");
const ASSIGNED_AT = new Date("2026-09-14T09:30:00.000Z");

type Assignee = {
  userId: string;
  assignedAt: Date;
  user: { displayName: string; nickname: string | null };
  assignedBy?: { displayName: string; nickname: string | null } | null;
};

function detailRow(assignees: Assignee[] = []) {
  return {
    id: "job-1",
    jobNumber: "HJ-2026-0001",
    title: "Nem indul a szivattyú",
    description: null,
    status: "NEW" as const,
    createdAt: CREATED_AT,
    scheduledAt: null,
    startedAt: null,
    completedAt: null,
    customerId: null,
    customer: null,
    events: [],
    worksheets: [],
    assets: [],
    assignees,
  };
}

/**
 * A NAPLO, AMIT A SZELETEK OLVASNAK: mit kapott a taroló, es mi ment ertesitesbe.
 *
 * A dupla SZANDEKOSAN a valodi metodusneveket viseli. Egy elgepelt nev itt
 * `undefined`-ot adna, a szolgaltatas elhasalna, es a piros a duplarol szolna,
 * nem a kodrol -- ezert a `ServiceJobsRepository` tipusan at all ossze.
 */
function setup(
  overrides: Partial<Record<keyof ServiceJobsRepository, unknown>> = {},
) {
  const created: Array<Record<string, unknown>> = [];
  const assigned: Array<Record<string, unknown>> = [];
  const notified: Array<{
    serviceJobId: string;
    subject: string;
    userIds: readonly string[];
  }> = [];

  const repository = {
    lastNumberOfYear: async () => null,
    assignableUserIds: async (ids: readonly string[]) => new Set(ids),
    create: async (input: Record<string, unknown>) => {
      created.push(input);
      return { id: "job-1", jobNumber: "HJ-2026-0001" };
    },
    setAssignees: async (input: Record<string, unknown>) => {
      assigned.push(input);
      return { ok: true, added: [...(input.userIds as string[])] };
    },
    detail: async () => detailRow(),
    documentRemovals: async () => [],
    ...overrides,
  } as unknown as ServiceJobsRepository;

  const notifications = {
    notifyServiceJobAssignment: (notice: {
      serviceJobId: string;
      subject: string;
      userIds: readonly string[];
    }) => {
      notified.push(notice);
    },
  } as unknown as NotificationsService;

  return {
    service: new ServiceJobsService(repository, notifications),
    created,
    assigned,
    notified,
  };
}

/**
 * A BELSO HIVO A TELJES RESZLETLAPOT KAPJA -- ES EZ ALLITAS, NEM KENYELEM.
 *
 * A `detail` 2026-09-21 ota ket alakot ad vissza (a partner sajat, szukebb
 * tipust kap). Ez a segedfuggveny nem csak szukit: KIMONDJA, hogy a belso
 * hivo tovabbra is a teljeset kapja. Enelkul egy kesobbi "egyszerusites"
 * MINDENKITOL elvehetne a mezoket, es a tesztek ettol meg zoldek maradnanak.
 */
function belsoReszletlap(
  detail: ServiceJobDetail | ServiceJobPartnerDetail,
): ServiceJobDetail {
  assert.ok(
    !isPartnerServiceJobDetail(detail),
    "a belso hivo a TELJES reszletlapot kapja",
  );
  return detail;
}

describe("a hibajegy delegálása felvitelkor", () => {
  it("a delegáltak a jeggyel EGY hívásban keletkeznek", async () => {
    const world = setup();

    await world.service.create(
      { title: "Nem indul a szivattyú", assigneeIds: ["user-2", "user-3"] },
      "user-1",
    );

    assert.deepEqual(world.created[0]?.assigneeIds, ["user-2", "user-3"]);
  });

  /**
   * ISMERT POZITIV KONTROLL a lenti tagadasokhoz: delegalt NELKUL is
   * megszuletik a jegy, es a lista URES -- nem hianyzik.
   */
  it("delegált nélkül is létrejön a jegy, üres listával", async () => {
    const world = setup();

    await world.service.create({ title: "Nem indul a szivattyú" }, "user-1");

    assert.deepEqual(world.created[0]?.assigneeIds, []);
    assert.equal(world.notified.length, 0);
  });

  it("az ismétlődő és üres azonosítók összevonva mennek tovább", async () => {
    const world = setup();

    await world.service.create(
      {
        title: "Nem indul a szivattyú",
        assigneeIds: [" user-2 ", "user-2", "", "  ", "user-3"],
      },
      "user-1",
    );

    assert.deepEqual(world.created[0]?.assigneeIds, ["user-2", "user-3"]);
  });

  /**
   * AZ ELLENORZES A LETREHOZAS ELOTT FUT, es ezt a MASODIK allitas meri.
   *
   * A kivetel onmagaban akkor is jonne, ha a jegy MAR letrejott volna -- es epp
   * az a delegalatlan, felkesz jegy keletkezne, amit el akarunk kerulni.
   */
  it("ismeretlen vagy nem szervizes kolléga esetén NEM születik jegy", async () => {
    const world = setup({ assignableUserIds: async () => new Set(["user-2"]) });

    await assert.rejects(
      () =>
        world.service.create(
          { title: "Nem indul a szivattyú", assigneeIds: ["user-2", "user-9"] },
          "user-1",
        ),
      BadRequestException,
    );

    assert.equal(world.created.length, 0);
  });

  it("felvitelkor minden delegált értesítést kap", async () => {
    const world = setup();

    await world.service.create(
      { title: "Nem indul a szivattyú", assigneeIds: ["user-2", "user-3"] },
      "user-1",
    );

    assert.deepEqual(world.notified, [
      {
        serviceJobId: "job-1",
        subject: "Nem indul a szivattyú",
        userIds: ["user-2", "user-3"],
      },
    ]);
  });
});

describe("a hibajegy delegálása a felvitel után", () => {
  it("a beküldött lista a teljes névsor, a jegy azonosítójával", async () => {
    const world = setup();

    await world.service.setAssignees(
      "job-1",
      { userIds: ["user-2", "user-3"] },
      BELSOS,
    );

    assert.deepEqual(world.assigned[0], {
      serviceJobId: "job-1",
      userIds: ["user-2", "user-3"],
      actorUserId: "user-1",
    });
  });

  /**
   * CSAK AZ UJAK KAPNAK ERTESITEST, es ez a szelet a lenyeg: aki mar a jegyen
   * allt, annak a telefonja hallgat. A taroló mondja meg, ki az uj -- a
   * szolgaltatas nem szamolja ujra, mert az osszevetes a TRANZAKCION BELUL
   * ervenyes csak.
   */
  it("csak az ÚJONNAN felkerült kolléga kap értesítést", async () => {
    const world = setup({
      setAssignees: async () => ({ ok: true, added: ["user-3"] }),
    });

    await world.service.setAssignees(
      "job-1",
      { userIds: ["user-2", "user-3"] },
      BELSOS,
    );

    assert.deepEqual(world.notified, [
      {
        serviceJobId: "job-1",
        subject: "Nem indul a szivattyú",
        userIds: ["user-3"],
      },
    ]);
  });

  /**
   * ISMERT POZITIV KONTROLL a fenti melle: ha SENKI nem uj, egyaltalan nem
   * megy ertesites. Enelkul a fenti allitast egy olyan valtozat is kielegitene,
   * ami mindig a taroló valaszat tovabbitja -- akkor is, ha az ures.
   */
  it("ha senki nem új, egy értesítés sem megy", async () => {
    const world = setup({
      setAssignees: async () => ({ ok: true, added: [] }),
    });

    await world.service.setAssignees("job-1", { userIds: ["user-2"] }, BELSOS);

    assert.equal(world.notified.length, 0);
  });

  /**
   * A TAROLOT NEM HELYETTESITJUK EBBEN A SZELETBEN, es ez nem veletlen: az
   * allitas azt meri, mit KAPOTT a taroló. Egy lecserelt `setAssignees` nem
   * jegyezne fel a hivast, es a szelet a sajat dupláját merne -- elso alakjaban
   * pontosan ezen bukott el.
   */
  it("üres listát küldeni szabad: mindenkit le lehet venni", async () => {
    const world = setup();

    await world.service.setAssignees("job-1", { userIds: [] }, BELSOS);

    assert.deepEqual(world.assigned[0]?.userIds, []);
    assert.equal(world.notified.length, 0);
  });

  it("ismeretlen kolléga esetén semmi nem íródik", async () => {
    const world = setup({ assignableUserIds: async () => new Set() });

    await assert.rejects(
      () =>
        world.service.setAssignees("job-1", { userIds: ["user-9"] }, BELSOS),
      BadRequestException,
    );

    assert.equal(world.assigned.length, 0);
    assert.equal(world.notified.length, 0);
  });

  it("nem létező jegyre nem található a válasz", async () => {
    const world = setup({
      setAssignees: async () => ({ ok: false, added: [] }),
    });

    await assert.rejects(
      () =>
        world.service.setAssignees("job-9", { userIds: ["user-2"] }, BELSOS),
      NotFoundException,
    );

    assert.equal(world.notified.length, 0);
  });
});

describe("a delegáltak a részletlapon", () => {
  it("a becenevén szerepel, ha van, és a kiosztás idejével", async () => {
    const world = setup({
      detail: async () =>
        detailRow([
          {
            userId: "user-2",
            assignedAt: ASSIGNED_AT,
            user: { displayName: "Kovács István", nickname: "Pista" },
            assignedBy: { displayName: "Tóth Gábor", nickname: null },
          },
          {
            userId: "user-3",
            assignedAt: ASSIGNED_AT,
            user: { displayName: "Nagy Éva", nickname: null },
            assignedBy: null,
          },
        ]),
    });

    const detail = belsoReszletlap(await world.service.detail("job-1", BELSOS));

    assert.deepEqual(detail.assignees, [
      {
        userId: "user-2",
        name: "Pista",
        assignedAt: "2026-09-14T09:30:00.000Z",
        assignedByName: "Tóth Gábor",
      },
      {
        userId: "user-3",
        name: "Nagy Éva",
        assignedAt: "2026-09-14T09:30:00.000Z",
        // NEGATÍV KONTROLL, UGYANABBAN A LISTÁBAN: `assignedBy` hiányzik
        // (a delegáló azonosítója törölve/ismeretlen), a mező `null` --
        // NEM esik ki csendben, és nem a másik sor nevét örökli.
        assignedByName: null,
      },
    ]);
  });

  /**
   * ISMERT POZITIV KONTROLL: delegalatlan jegyen a mezo OTT VAN, uresen. Egy
   * hianyzo kulcs a feluleten `undefined` lenne, es az nem ugyanaz, mint az
   * "egyelore senki".
   */
  it("delegálatlan jegyen üres lista áll, nem hiányzó mező", async () => {
    const world = setup();

    const detail = belsoReszletlap(await world.service.detail("job-1", BELSOS));

    assert.deepEqual(detail.assignees, []);
  });
});

/**
 * AZ ERTESITO BEKOTESE A MODULBA.
 *
 * A szolgaltatas `@Optional()` fuggosegkent veszi at, mert a modul hat masik
 * specje nem allitja elo. Egy elhagyhato fuggoseg viszont NEMA: ha a modul
 * elfelejtene bekotni, a delegalas lefutna, ertesites nelkul, es semmi nem
 * szolna rola -- se hiba, se naplo.
 *
 * AMIT EZ MER, ES AMIT NEM: a modul METAADATAT olvassa, tehat azt allitja, hogy
 * az ertesito modulja be van huzva. Azt NEM, hogy a Nest futasidoben tenyleg
 * beinjektalja (ahhoz elo alkalmazas kellene). A ket romlas kozul viszont ez az
 * egy az, ami egy sor torlesevel bekovetkezhet.
 */
describe("a modul beköti az értesítőt", () => {
  it("a ServiceJobsModule importálja a NotificationsModule-t", () => {
    const imports = Reflect.getMetadata("imports", ServiceJobsModule) as
      unknown[] | undefined;

    assert.ok(
      imports?.includes(NotificationsModule),
      "a ServiceJobsModule nem importálja a NotificationsModule-t: a delegálás értesítés nélkül futna le",
    );
  });
});

/**
 * AKI EPP KIOSZT, NEM KAP SAJAT TETTEROL ERTESITEST (efc139ba).
 *
 * A KET HIVOHELY BEMENETE MAST JELENT, ES EZERT ALL MIND A KETTORE KULON
 * ALLITAS: a felvitelnel a TELJES uj nevsor megy, a kesobbi atszervezesnel
 * CSAK a hozzaadottak. A szures szabalya ugyanaz, a jelentese nem -- egy kozos
 * helper mogott konnyu osszemosni oket, es akkor egy rontas mind a kettot
 * elvinne eszrevetlenul.
 */
describe("a kiosztó nem kap értesítést a saját tettéről", () => {
  it("FELVITELKOR kimarad a listából, a többiek megkapják", async () => {
    const world = setup();

    await world.service.create(
      {
        title: "Nem indul a szivattyú",
        assigneeIds: ["user-1", "user-2", "user-3"],
      },
      "user-1",
    );

    assert.deepEqual(world.notified, [
      {
        serviceJobId: "job-1",
        subject: "Nem indul a szivattyú",
        userIds: ["user-2", "user-3"],
      },
    ]);

    /*
      ES A JEGYRE ATTOL MEG FELKERUL. A szures az ERTESITESROL szol, nem a
      delegalasrol -- aki magat is ratette, ott all a nevsoron.
    */
    assert.deepEqual(world.created[0]?.assigneeIds, [
      "user-1",
      "user-2",
      "user-3",
    ]);
  });

  it("ÁTSZERVEZÉSKOR kimarad a hozzáadottak közül", async () => {
    const world = setup({
      setAssignees: async () => ({ ok: true, added: ["user-1", "user-3"] }),
    });

    await world.service.setAssignees(
      "job-1",
      { userIds: ["user-1", "user-2", "user-3"] },
      BELSOS,
    );

    assert.deepEqual(world.notified, [
      {
        serviceJobId: "job-1",
        subject: "Nem indul a szivattyú",
        userIds: ["user-3"],
      },
    ]);
  });

  /**
   * ES EZ DONTES, NEM KOVETKEZMENY (acrobot, 2026-09-21): aki EGYEDUL sajat
   * magat osztja ki, EGYALTALAN nem kap ertesitest.
   *
   * Lehetne maskepp is -- mindenki kap, aki a listan all --, es akkor a sajat
   * nev is jarna. Azert all igy, mert aki epp most nyomta meg a gombot, TUDJA.
   *
   * A KULON ALLITAS AZERT KELL, mert e nelkul a dontes csak a kodban allna, es
   * a kovetkezo olvasonak kovetkezmenynek latszana -- barmikor
   * "egyszerusithetonek".
   *
   * ES A FELTETEL A SZURT LISTARA ALL: nyers hosszra kotve itt egy URES
   * nevsorral hivnank az ertesitot.
   */
  it("aki EGYEDÜL magát osztja ki, egy értesítés sem megy", async () => {
    const world = setup();

    await world.service.create(
      { title: "Nem indul a szivattyú", assigneeIds: ["user-1"] },
      "user-1",
    );

    assert.equal(world.notified.length, 0);
    // ISMERT POZITIV KONTROLL: a jegy attol meg letrejott, a nevsorral egyutt.
    assert.deepEqual(world.created[0]?.assigneeIds, ["user-1"]);
  });
});
