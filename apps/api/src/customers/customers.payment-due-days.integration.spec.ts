import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { CustomersRepository } from "./customers.repository.js";

/**
 * A VEVŐ FIZETÉSI HATÁRIDEJE A SOR SZINTJÉN, valódi Postgresen (Balázs 2026-11-11 10:58 UTC). MI PIROSÍT: a létrehozás nem írja a
 * napot; a módosítás egy másik mező mentésekor nullázza (a hiányzó mező a TÁROLT napot érintetlenül hagyja); a `null` nem töröl;
 * a nulla "nincs"-ként tárolódik; a részletek nem adják vissza.
 */
const gate = integrationDatabaseGate(process.env);
const PREFIX = "PAYDAYS-";

describe(
  "CustomersRepository, payment due days",
  { skip: gate.mode === "skip" },
  () => {
    const repository = new CustomersRepository();
    let actorId = "";
    const n = Date.now() % 1_000_000;

    const clean = async () => {
      await prisma.domainEvent.deleteMany({
        where: { actor: { email: { startsWith: PREFIX } } },
      });
      await prisma.customer.deleteMany({
        where: { displayName: { startsWith: PREFIX } },
      });
      await prisma.user.deleteMany({
        where: { email: { startsWith: PREFIX } },
      });
    };

    before(async () => {
      if (gate.mode === "refuse") throw new Error(gate.reason);
      await clean();
      const user = await prisma.user.create({
        data: {
          email: `${PREFIX}${n}@example.test`,
          displayName: "Teszt",
          passwordHash: "x",
          role: "ADMIN",
        },
        select: { id: true },
      });
      actorId = user.id;
    });

    after(async () => {
      if (gate.mode === "run") await clean();
    });

    const create = (paymentDueDays?: number) =>
      repository.create(
        {
          type: "COMPANY",
          displayName: `${PREFIX}${n}-${paymentDueDays ?? "none"}`,
          ...(paymentDueDays === undefined ? {} : { paymentDueDays }),
          addresses: [],
        } as never,
        actorId,
      );

    it("create stores the days, and a customer created without them has none", async () => {
      assert.equal((await create(30)).paymentDueDays, 30);
      assert.equal((await create()).paymentDueDays, null);
      assert.equal(
        (await create(0)).paymentDueDays,
        0,
        "zero is a value, not 'none'",
      );
    });

    it("update: a missing field leaves the stored days, a number replaces them, null clears them", async () => {
      const made = await create(30);
      const other = await repository.update(
        made.id,
        { phone: "+36 1 234 5678", expectedUpdatedAt: made.updatedAt },
        actorId,
      );
      assert.equal(
        other.paymentDueDays,
        30,
        "saving another field does not touch the days",
      );
      const changed = await repository.update(
        made.id,
        { paymentDueDays: 15, expectedUpdatedAt: other.updatedAt },
        actorId,
      );
      assert.equal(changed.paymentDueDays, 15);
      const cleared = await repository.update(
        made.id,
        { paymentDueDays: null, expectedUpdatedAt: changed.updatedAt },
        actorId,
      );
      assert.equal(cleared.paymentDueDays, null);
    });
  },
);
