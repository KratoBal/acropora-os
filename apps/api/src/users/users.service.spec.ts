import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { UsersRepository } from "./users.repository.js";
import { UsersService } from "./users.service.js";

const user = {
  id: "user-1",
  firstName: "Réka",
  lastName: "Kovács",
  displayName: "Kovács Réka",
  email: "reka.kovacs@acropora.hu",
  role: "SALES" as const,
  isActive: true,
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};
const repository = (overrides: Record<string, unknown> = {}) =>
  ({
    list: async () => ({
      items: [user],
      pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 },
    }),
    detail: async () => user,
    /**
     * A VARRAT, ES EZERT ALL AZ ALAPERTELMEZETT DUPLABAN IS.
     *
     * A szolgaltatas ezt HIVJA, valahanyszor `customerId` erkezik. Ha csak
     * azokban a tesztekben allna, amik ezt az agat meric, minden TOBBI teszt
     * ugy menne at, hogy a metodus nem letezik -- es a hiba csak akkor jonne
     * elo, amikor valaki egy meglevo tesztet kiegeszit egy vevovel. Amit a
     * hivo hasznal, de a teszt nem allit, az a dupla biztos hibaja.
     */
    customerExists: async () => true,
    create: async () => user,
    update: async () => user,
    setPassword: async () => user,
    setActive: async (_id: string, isActive: boolean) => ({
      ...user,
      isActive,
    }),
    ...overrides,
  }) as unknown as UsersRepository;

describe("UsersService", () => {
  it("creates a valid user", async () =>
    assert.equal(
      (
        await new UsersService(repository()).create(
          {
            firstName: "Réka",
            lastName: "Kovács",
            email: "reka.kovacs@acropora.hu",
            role: "SALES",
            password: "correct-horse-battery",
          },
          "owner",
        )
      ).id,
      "user-1",
    ));

  it("maps duplicate email conflicts", async () => {
    const error = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "6",
    });
    await assert.rejects(
      () =>
        new UsersService(
          repository({
            create: async () => {
              throw error;
            },
          }),
        ).create(
          {
            firstName: "Réka",
            lastName: "Kovács",
            email: "reka.kovacs@acropora.hu",
            role: "SALES",
          },
          "owner",
        ),
      ConflictException,
    );
  });

  it("updates with optimistic concurrency", async () =>
    assert.equal(
      (
        await new UsersService(repository()).update(
          "user-1",
          { lastName: "Kovács", expectedUpdatedAt: user.updatedAt },
          "owner",
        )
      ).lastName,
      "Kovács",
    ));

  it("maps stale updates to conflict", async () =>
    await assert.rejects(
      () =>
        new UsersService(
          repository({
            update: async () => {
              throw new Error("STALE_UPDATE");
            },
          }),
        ).update("user-1", { expectedUpdatedAt: user.updatedAt }, "owner"),
      ConflictException,
    ));

  it("sets a new password for an existing user", async () => {
    const result = await new UsersService(repository()).setPassword(
      "user-1",
      { password: "another-strong-password" },
      "owner",
    );
    assert.equal(result.id, "user-1");
  });

  it("rejects missing users", async () =>
    await assert.rejects(
      () =>
        new UsersService(repository({ detail: async () => null })).detail(
          "missing",
        ),
      NotFoundException,
    ));

  it("activates and deactivates users", async () => {
    const service = new UsersService(repository());
    assert.equal((await service.deactivate("user-1", "owner")).isActive, false);
    assert.equal((await service.activate("user-1", "owner")).isActive, true);
  });

  it("prevents an admin from deactivating themselves", async () =>
    await assert.rejects(
      () => new UsersService(repository()).deactivate("owner", "owner"),
      BadRequestException,
    ));

  it("returns deterministic repository pagination", async () => {
    const result = await new UsersService(repository()).list({
      page: 1,
      pageSize: 25,
      status: "ACTIVE",
    });
    assert.deepEqual(
      result.items.map((item) => item.email),
      ["reka.kovacs@acropora.hu"],
    );
  });
});

describe("a felhasználó vevőhöz kötése", () => {
  /*
    EZ A MEZO NEM ADATMEZO, HANEM HATOKORT ADO VEZERLO: a `partnerScopeOf`
    ebbol szamolja, mit lat az illeto. Ezert nem eleg, hogy „atmegy": a lenti
    harom allitas azt koti le, hogy MIT nem enged at.
  */

  it("NEM LETEZO vevore ertheto hibat ad, nem adatbazis-hibat", async () => {
    /*
      A relacion idegenkulcs all, tehat enelkul is elbukna a beszuras -- de egy
      nyers `P2003` a kepernyon ertelmezhetetlen, es nem mondja meg, MELYIK
      mezovel van baj.

      MI PIROSIT: az ellenorzes elhagyasa. Akkor a hivas eljutna a
      repositoryig, es a dupla `create` fuggvenye csendben SIKERT adna --
      vagyis a teszt nem csak a hibauzenetet veszitene el, hanem azt is
      allitana, hogy a felvitel MUKODIK egy nem letezo vevovel.
    */
    await assert.rejects(
      () =>
        new UsersService(
          repository({ customerExists: async () => false }),
        ).create(
          {
            firstName: "Réka",
            lastName: "Kovács",
            email: "reka.kovacs@acropora.hu",
            role: "SALES",
            customerId: "nincs-ilyen",
          },
          "actor-1",
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /vevő nem található/.test(error.message),
    );
  });

  it("MAR SZALLITOHOZ kotott fiokot nem enged vevohoz kotni", async () => {
    /*
      Az adatbazisban `CHECK` all ra, tehat a masodik kotes ott ugyis elbukna.
      A KOVETKEZMENYE viszont nem egy hibauzenet: a `partnerScopeOf` DOB, ha
      mind a ketto ki van toltve, vagyis egy ilyen sor tulajdonosa MINDEN
      keresre hibat kapna, es a felulet szamara ugy nezne ki, mintha a fiok
      elromlott volna.

      MI PIROSIT: az ellenorzes elhagyasa -- olyankor a `CHECK` sertes nyers
      adatbazis-hibakent jutna ki, ha egyaltalan.
    */
    await assert.rejects(
      () =>
        new UsersService(
          repository({
            detail: async () => ({ ...user, supplierId: "supplier-1" }),
          }),
        ).update(
          "user-1",
          {
            customerId: "customer-1",
            expectedUpdatedAt: "2026-01-02T00:00:00.000Z",
          },
          "actor-1",
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        /szállítóhoz van kötve/.test(error.message),
    );
  });

  it("a KOTES MEGSZUNTETESE (null) NEM esik bele a fenti ket kapuba", async () => {
    /*
      EZ AZ AG A LEGKONNYEBBEN ELRONTHATO, es a hibaja NEM latszana: a torles
      TAGITJA a hatokort (partner nelkul a fiok belsos, es mindent lat). Ha egy
      ellenorzes tulzottan szeles lenne, epp ez a muvelet akadna el -- egy
      szallitohoz kotott fiokrol nem lehetne levenni a kotest, mert a
      „mar partnerhez kotott" kapu ravaltana.

      MI PIROSIT: ha a ket kapu barmelyike a `null` erteket is vizsgalna.
    */
    const updated = await new UsersService(
      repository({
        detail: async () => ({ ...user, supplierId: "supplier-1" }),
        customerExists: async () => false,
      }),
    ).update(
      "user-1",
      { customerId: null, expectedUpdatedAt: "2026-01-02T00:00:00.000Z" },
      "actor-1",
    );
    assert.equal(updated?.id, "user-1");
  });
});
