import "reflect-metadata";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PERMISSIONS, type AuthenticatedUser } from "@acropora/types";

import { REQUIRED_PERMISSIONS_KEY } from "../auth/decorators/require-permissions.decorator.js";
import {
  decideManualAccount,
  type ManualContext,
} from "./supplier-bank-account-manual.js";
import { ManualSupplierAccountController } from "./supplier-bank-account-manual.controller.js";

/*
  A KÉZI MEGADÁS DÖNTÉSE ÉS VÉGPONTJA (acrobot 58655). MI PIROSÍT: ha érvénytelen számlaszám elmenne; ha a csak névvel azonosított vagy csoportos adószámú szállítóra írna; ha a sor saját
  számlaszámát átírná; ha a másik számlán vagy a törzsben álló számlaszám mellett hatástalanul írna; ha meglévő kitöltést megerősítés nélkül felülírna; ha ugyanaz a számlaszám újraírna;
  ha a sorrend felcserélődne (a saját számlaszám előbbre való a kitöltésnél); ha a végpont nem a Pénzügy írási jogát kérné; ha a hibák a rossz státuszkóddal mennének.
*/
const A = "1177301611111018";
const B = "1091800100000017";
const ctx = (over: Partial<ManualContext> = {}): ManualContext => ({
  key: "hu:12345678",
  rowHasOwnAccount: false,
  shadowedBy: null,
  fill: null,
  ...over,
});
const decide = (
  over: Partial<ManualContext> = {},
  account: string | null = A,
  confirmReplace = false,
) => decideManualAccount({ context: ctx(over), account, confirmReplace });

describe("a kézi megadás döntése", () => {
  it("üres környezetben létrehoz", () => {
    assert.deepEqual(decide(), { kind: "CREATE" });
  });

  it("érvénytelen számlaszám elutasítva, mindennél előbb", () => {
    assert.deepEqual(decide({ key: null, rowHasOwnAccount: true }, null), {
      kind: "INVALID_ACCOUNT",
    });
  });

  it("a csak névvel azonosított szállítóra nem ír (nincs kulcs, name: kulcs)", () => {
    assert.deepEqual(decide({ key: null }), { kind: "NO_STRONG_KEY" });
    assert.deepEqual(decide({ key: "name:euro corals" }), {
      kind: "NO_STRONG_KEY",
    });
    assert.deepEqual(decide({ key: "eu:ATU63964918" }), { kind: "CREATE" });
  });

  it("a sor saját számlaszáma nem írható át, és előbbre való a másik forrásnál és a kitöltésnél is", () => {
    assert.deepEqual(
      decide({
        rowHasOwnAccount: true,
        shadowedBy: "MASTER",
        fill: { account: B, source: "MANUAL" },
      }),
      { kind: "HAS_OWN_ACCOUNT" },
    );
  });

  it("a másik számlán vagy a törzsben álló számlaszám előbbre való: a megadás hatástalan lenne, elutasítva", () => {
    assert.deepEqual(decide({ shadowedBy: "OTHER_INVOICE" }), {
      kind: "SHADOWED",
      by: "OTHER_INVOICE",
      conflicting: false,
    });
    assert.deepEqual(
      decide({ shadowedBy: "MASTER", fill: { account: B, source: "MANUAL" } }),
      { kind: "SHADOWED", by: "MASTER", conflicting: false },
    );
    // két különböző számlaszám az előbbre való szinten: a szállító adatai ellentmondanak (barracuda #2802)
    assert.deepEqual(
      decide({ shadowedBy: "OTHER_INVOICE", shadowDistinct: 2 }),
      {
        kind: "SHADOWED",
        by: "OTHER_INVOICE",
        conflicting: true,
      },
    );
  });

  it("meglévő kitöltés: ugyanaz a számlaszám változatlan; más számlaszám megerősítés nélkül CSERE_KELL, megerősítéssel csere a korábbi értékkel", () => {
    const fill = { account: B, source: "INVOICE_PDF" as const };
    assert.deepEqual(decide({ fill }, B), { kind: "UNCHANGED" });
    assert.deepEqual(decide({ fill }, A), {
      kind: "REPLACE_REQUIRED",
      existing: fill,
    });
    assert.deepEqual(decide({ fill }, A, true), {
      kind: "REPLACE",
      previous: fill,
    });
    // a megerősítés önmagában nem ír, ha ugyanaz a számlaszám
    assert.deepEqual(decide({ fill }, B, true), { kind: "UNCHANGED" });
  });
});

describe("a kézi megadás végpontja", () => {
  const user = { id: "u1" } as AuthenticatedUser;
  const controllerWith = (tx: Record<string, unknown>) => {
    const controller = new ManualSupplierAccountController();
    Object.assign(controller, {
      database: { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) },
    });
    return controller;
  };
  const row = {
    id: "r1",
    documentNumber: "SZ-1",
    supplierName: "Példa Kft.",
    supplierTaxNumber: "12345678-2-13",
    supplierEuTaxNumber: null,
    supplierBankAccount: null as string | null,
  };
  const tx = (over: {
    row?: unknown;
    siblings?: unknown[];
    masters?: unknown[];
    fill?: unknown;
  }) => {
    const writes: string[] = [];
    const audits: {
      action: string;
      userId: string;
      metadata: Record<string, unknown>;
    }[] = [];
    return {
      writes,
      audits,
      tx: {
        incomingBillingDocument: {
          findUnique: async () => ("row" in over ? over.row : row),
          findMany: async () => over.siblings ?? [],
        },
        supplier: { findMany: async () => over.masters ?? [] },
        supplierBankAccountFill: {
          findUnique: async () => over.fill ?? null,
          findUniqueOrThrow: async () => ({ id: "f1" }),
          create: async () => (writes.push("create"), { id: "f1" }),
          update: async () => (writes.push("update"), { id: "f1" }),
        },
        auditLog: {
          create: async ({
            data,
          }: {
            data: {
              action: string;
              userId: string;
              metadata: Record<string, unknown>;
            };
          }) => (audits.push(data), writes.push(data.action)),
        },
      },
    };
  };

  it("a Pénzügy írási jogát kéri", () => {
    assert.deepEqual(
      Reflect.getMetadata(
        REQUIRED_PERMISSIONS_KEY,
        ManualSupplierAccountController,
      ),
      [PERMISSIONS.FINANCE_MANAGE],
    );
  });

  it("létrehoz és naplóz, a számlaszámot a lista alakjában adja vissza", async () => {
    const { tx: t, writes } = tx({});
    const out = await controllerWith(t).set(
      "r1",
      { account: "11773016-11111018-00000000" },
      user,
    );
    assert.deepEqual(out, { account: "11773016-11111018", changed: true });
    assert.deepEqual(writes, [
      "create",
      "billing.supplier-account.manual-entered",
    ]);
  });

  it("a hibák a megfelelő státusszal mennek: 400, 404, 422, 409", async () => {
    const bad = (t: Record<string, unknown>, account: string, ex: unknown) =>
      assert.rejects(
        controllerWith(t).set("r1", { account }, user),
        (error: unknown) => error instanceof (ex as typeof Error),
      );
    await bad(tx({}).tx, "11773016-11111019-00000000", BadRequestException);
    await bad(tx({ row: null }).tx, "11773016-11111018", NotFoundException);
    await bad(
      tx({ row: { ...row, supplierBankAccount: "11700000-12345678" } }).tx,
      "11773016-11111018",
      UnprocessableEntityException,
    );
    await bad(
      tx({ row: { ...row, supplierTaxNumber: null } }).tx,
      "11773016-11111018",
      UnprocessableEntityException,
    );
    await bad(
      tx({ fill: { account: B, source: "INVOICE_PDF" } }).tx,
      "11773016-11111018",
      ConflictException,
    );
  });

  it("két egyidejű első megadás (az egyedi szállító-kulcs ütközése, P2002) 409 érthető mondattal, nem 500", async () => {
    const { tx: t } = tx({});
    (t.supplierBankAccountFill as { create: unknown }).create = async () => {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
      });
    };
    await assert.rejects(
      controllerWith(t).set("r1", { account: "11773016-11111018" }, user),
      (error: unknown) =>
        error instanceof ConflictException &&
        /közben megadták/.test(error.message),
    );
    // más hiba nem nyelődik el
    (t.supplierBankAccountFill as { create: unknown }).create = async () => {
      throw new Error("kapcsolat megszakadt");
    };
    await assert.rejects(
      controllerWith(t).set("r1", { account: "11773016-11111018" }, user),
      /kapcsolat megszakadt/,
    );
  });

  it("ha a szállító másik számláin két különböző számlaszám áll, a 422 mondata kimondja az ellentmondást (barracuda #2802)", async () => {
    const sibling = (account: string) => ({
      supplierName: "Példa Kft.",
      supplierTaxNumber: "12345678-2-13",
      supplierEuTaxNumber: null,
      supplierBankAccount: account,
    });
    await assert.rejects(
      controllerWith(
        tx({ siblings: [sibling("11773016-11111018"), sibling(B)] }).tx,
      ).set("r1", { account: "10918001-00000017" }, user),
      (error: unknown) =>
        error instanceof UnprocessableEntityException &&
        /ellentmondanak/.test(error.message),
    );
    // egy számlaszám mellett a szokásos mondat áll, nem az ellentmondás
    await assert.rejects(
      controllerWith(tx({ siblings: [sibling("11773016-11111018")] }).tx).set(
        "r1",
        { account: "10918001-00000017" },
        user,
      ),
      (error: unknown) =>
        error instanceof UnprocessableEntityException &&
        !/ellentmondanak/.test(error.message) &&
        /másik számláján/.test(error.message),
    );
  });

  it("a megerősített csere ír, és a naplóba a korábbi számlaszám is kerül", async () => {
    const {
      tx: t,
      writes,
      audits,
    } = tx({
      fill: { account: B, source: "INVOICE_PDF" },
    });
    const out = await controllerWith(t).set(
      "r1",
      { account: "11773016-11111018", confirmReplace: true },
      user,
    );
    assert.equal(out.changed, true);
    assert.deepEqual(writes, [
      "update",
      "billing.supplier-account.manual-replaced",
    ]);
    // ki és melyik korábbi értéket váltotta: egy téves csere visszaállítható
    assert.equal(audits[0]!.userId, "u1");
    assert.equal(audits[0]!.metadata.previousAccount, B);
    assert.equal(audits[0]!.metadata.previousSource, "INVOICE_PDF");
    assert.equal(audits[0]!.metadata.accountLast4, "1018");
  });
});
