import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AuthenticatedUser } from "@acropora/types";

import { ServiceJobsModule } from "./service-jobs.module.js";
import { ServiceJobsService } from "./service-jobs.service.js";
import type { ServiceJobsRepository } from "./service-jobs.repository.js";
import type { NotificationsService } from "../notifications/notifications.service.js";
import type { TicketMailService } from "../notifications/mail/ticket-mail.service.js";

/**
 * UGYFEL NYIT HIBAJEGYET -> A FELELOS-SZEREP BIRTOKOSAI ERTESULNEK.
 *
 * Balazs kerese, 2026-09-22 (ertesitesi folyamat, 1. pont).
 *
 * A VARRATOK A VALODI SZERZODES TIPUSAT KAPJAK: ha barmelyik szignatura
 * elmozdul, a fordito szoljon, ne a felhasznalo.
 */

type Cimzett = { id: string; email: string; displayName: string };

function keszit(be: {
  cimzettek?: Cimzett[];
  partnerCode?: string | null;
  cimzettHiba?: boolean;
}) {
  const pushok: Parameters<
    NotificationsService["notifyServiceJobOpened"]
  >[0][] = [];
  const levelek: Parameters<TicketMailService["deliverServiceJobOpened"]>[0][] =
    [];

  const repository: Pick<
    ServiceJobsRepository,
    | "placementOfAsset"
    | "assetsOutsideDepartment"
    | "departmentBelongsToCustomer"
    | "lastNumberOfYear"
    | "create"
    | "assignedUnitIds"
    | "notificationRoleRecipients"
    | "partnerCodeOf"
  > = {
    placementOfAsset: async () => null,
    assetsOutsideDepartment: async () => [],
    departmentBelongsToCustomer: async () => true,
    lastNumberOfYear: async () => null,
    create: async () => ({ id: "job-1", jobNumber: "HJ-2026-0001" }) as never,
    assignedUnitIds: async () => ["dep-1"],
    notificationRoleRecipients: async () => {
      if (be.cimzettHiba) throw new Error("az adatbázis nem érhető el");
      return be.cimzettek ?? [];
    },
    partnerCodeOf: async () => be.partnerCode ?? null,
  };

  const notifications = {
    notifyServiceJobOpened: (notice: (typeof pushok)[number]) => {
      pushok.push(notice);
    },
    notifyServiceJobAssignment: () => {},
  } as unknown as NotificationsService;

  const ticketMail = {
    deliverServiceJobOpened: async (input: (typeof levelek)[number]) => {
      levelek.push(input);
      return { kind: "sent" as const };
    },
  } as unknown as TicketMailService;

  return {
    service: new ServiceJobsService(
      repository as ServiceJobsRepository,
      notifications,
      ticketMail,
    ),
    pushok,
    levelek,
  };
}

const VEVO: AuthenticatedUser = {
  id: "user-partner",
  email: "vevo@pelda.invalid",
  displayName: "Vevő Vera",
  role: "PARTNER_SERVICE",
  customerId: "cus-1",
  supplierId: null,
} as never;

const BELSOS: AuthenticatedUser = {
  id: "user-belsos",
  email: "belsos@acropora.local",
  displayName: "Belsős Béla",
  role: "OWNER",
  customerId: null,
  supplierId: null,
} as never;

const BEMENET = { title: "Szivattyú zúg", departmentId: "dep-1" } as never;

/**
 * A BELSOS FELVITEL MAS ALAKU, ES EZT A TESZT TALALTA MEG.
 *
 * Elso valtozatban ugyanazt a bemenetet adtam a belsosnek is, es a
 * `create` elutasitotta: „Helyszínt csak partnerrel együtt lehet megadni."
 * A vevo-hatokoru hivonal az ugyfel a HATOKORBOL jon, a belsosnel viszont a
 * bemenetbol -- ezert kell ide a `customerId`.
 *
 * NEM A `departmentId`-T VETTEM KI: egy helyszin nelkuli bemenet MASIK
 * viselkedest merne, es akkor az U2 nem ugyanazt az utat jarna, mint az U1.
 */
const BELSOS_BEMENET = {
  title: "Szivattyú zúg",
  customerId: "cus-1",
  departmentId: "dep-1",
} as never;

const FELELOS: Cimzett = {
  id: "user-felelos",
  email: "felelos@acropora.local",
  displayName: "Felelős Fanni",
};

describe("ügyfél-bejelentés értesítése", () => {
  it("U1: a felelős push-t kap, az ügyfélkóddal a címben", async () => {
    const { service, pushok } = keszit({
      cimzettek: [FELELOS],
      partnerCode: "FANK",
    });

    await service.create(BEMENET, VEVO);

    assert.equal(pushok.length, 1);
    assert.deepEqual(pushok[0]?.userIds, ["user-felelos"]);
    assert.equal(pushok[0]?.partnerCode, "FANK");
  });

  /**
   * U2: A HATAR A HATOKOR, NEM A DELEGALT-LISTA.
   *
   * Egy belsos kollega is nyithat jegyet delegalt nelkul, es arrol EZ az
   * ertesites nem szol. E nelkul az allitas nelkul egy "mindig kuldj"
   * megvalositas is zold lenne -- es a felelos minden sajat felvitelunkrol
   * kapna push-t.
   */
  it("U2: belsős felvitelnél NEM megy értesítés", async () => {
    const { service, pushok, levelek } = keszit({ cimzettek: [FELELOS] });

    await service.create(BELSOS_BEMENET, BELSOS);

    assert.deepEqual(pushok, []);
    assert.deepEqual(levelek, []);
  });

  it("U3: ha senkinél nincs bejelölve, se push, se levél", async () => {
    const { service, pushok, levelek } = keszit({ cimzettek: [] });

    await service.create(BEMENET, VEVO);

    assert.deepEqual(pushok, []);
    assert.deepEqual(levelek, []);
  });

  /**
   * U4: A PUSH ES A LEVEL UGYANAZT A HALMAZT KAPJA.
   *
   * A cimzetteket EGYSZER kerdezzuk le, es mind a ketto azt kapja. Ket kulon
   * lekerdezes kozott a halmaz megvaltozhatna, es a push egy embernek menne
   * ki, a level egy masiknak -- ugyanarrol a jegyrol.
   */
  it("U4: a push és a levél ugyanazt a címzett-halmazt kapja", async () => {
    const masodik: Cimzett = {
      id: "user-masodik",
      email: "masodik@acropora.local",
      displayName: "Második Márta",
    };
    const { service, pushok, levelek } = keszit({
      cimzettek: [FELELOS, masodik],
    });

    await service.create(BEMENET, VEVO);

    assert.deepEqual(pushok[0]?.userIds, ["user-felelos", "user-masodik"]);
    assert.deepEqual(
      levelek[0]?.recipients.map((cimzett) => cimzett.email),
      [FELELOS.email, masodik.email],
    );
  });

  /**
   * U5: AZ ERTESITES HIBAJA NEM BUKTATJA EL A FELVITELT.
   *
   * A jegy MAR TAROLVA van, amikor az ertesites fut. Ha egy hiba felszallna, a
   * bejelento "nem sikerult"-et latna egy LETREJOTT jegyre, ujra bekuldene, es
   * ket jegy lenne ugyanarrol a hibarol.
   */
  it("U5: az értesítés hibája nem buktatja el a felvitelt", async () => {
    const { service, pushok } = keszit({ cimzettHiba: true });

    const created = await service.create(BEMENET, VEVO);

    assert.equal((created as { id: string }).id, "job-1");
    assert.deepEqual(pushok, []);
  });

  /**
   * U6: A MODUL BEKOTI A LEVELEZOT.
   *
   * A fuggoseg `@Optional()`: ha a modul elfelejtene, a szolgaltatas
   * `undefined`-ot kapna, a push kimenne, a LEVEL pedig CSENDBEN elmaradna.
   * Ez a metaadatot olvassa, nem azt, hogy a mezo letezik.
   */
  it("U6: a modul importálja az értesítő modult", () => {
    const importok: unknown[] =
      Reflect.getMetadata("imports", ServiceJobsModule) ?? [];

    assert.ok(
      importok.some(
        (modul) =>
          typeof modul === "function" && modul.name === "NotificationsModule",
      ),
      "a NotificationsModule adja a TicketMailService-t is",
    );
  });
});
