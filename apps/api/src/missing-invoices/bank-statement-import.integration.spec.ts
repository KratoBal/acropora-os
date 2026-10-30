import "reflect-metadata";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { prisma } from "@acropora/database";
import type { AuthenticatedUser } from "@acropora/types";

import { integrationDatabaseGate } from "../common/integration-database.js";
import { nincsMaradek } from "../common/takaritas-leltar.js";
import { BankStatementImportRepository } from "./bank-statement-import.repository.js";
import { BankStatementImportService } from "./bank-statement-import.service.js";
import { SzamlazzBanktranzService } from "./szamlazz-banktranz.service.js";

/**
 * A KIVONAT-FELTÖLTÉS VALÓDI ADATBÁZISON: a bankszámla egyszer jön létre; a
 * második, átfedő export csak az új sorát írja be; ugyanaz a fájl másodszor
 * semmit; egy exporton belüli két azonos sor két tétel.
 */
const gate = integrationDatabaseGate(process.env);
const ACCOUNT = "9999000011112222";
const IMPORTER = "missing-invoices-it";
const USER = { id: IMPORTER } as AuthenticatedUser;

const line = (day: string, amount: number, name: string) =>
  `"${ACCOUNT}";T;-${amount};HUF;${day};${day};;;"${name}";"teszt";;;KÁRTYÁS VÁSÁRLÁS;;`;
const file = (name: string, lines: string[]) => ({
  originalname: name,
  buffer: Buffer.from(lines.join("\r\n"), "utf8"),
});

async function removeLeftovers() {
  await prisma.bankTransaction.deleteMany({
    where: { bankAccount: { accountNumber: ACCOUNT } },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { importedByUserId: IMPORTER },
  });
  await prisma.bankStatementImport.deleteMany({
    where: { fileName: { startsWith: "Számlázz.hu banki tranzakció #9900" } },
  });
  await prisma.bankAccount.deleteMany({ where: { accountNumber: ACCOUNT } });
}

describe("a havi kivonat feltöltése", { skip: gate.mode === "skip" }, () => {
  const service = new BankStatementImportService(
    new BankStatementImportRepository(),
  );

  before(async () => {
    if (gate.mode === "refuse") throw new Error(gate.reason);
    await removeLeftovers();
  });

  after(async () => {
    await removeLeftovers();
    nincsMaradek([
      {
        nev: "a suite bankszámlája bent maradt",
        darab: await prisma.bankAccount.count({
          where: { accountNumber: ACCOUNT },
        }),
      },
    ]);
  });

  it("writes each payment once across overlapping exports, and keeps two identical payments of one export", async () => {
    const july = file("export-24.csv", [
      line("20260730", 1000, "Bolt"),
      line("20260803", 23810, "Alza"),
      line("20260803", 23810, "Alza"),
    ]);
    const first = await service.import(july, USER);
    assert.deepEqual(
      [first.rowCount, first.createdCount, first.skippedCount],
      [3, 3, 0],
    );
    assert.deepEqual(first.months, ["2026-07", "2026-08"]);

    // the August export repeats the overlapping day, and adds one new row
    const august = file("export-27.csv", [
      line("20260803", 23810, "Alza"),
      line("20260803", 23810, "Alza"),
      line("20260805", 500, "Posta"),
    ]);
    const second = await service.import(august, USER);
    assert.deepEqual([second.createdCount, second.skippedCount], [1, 2]);

    const again = await service.import(july, USER);
    assert.deepEqual([again.createdCount, again.skippedCount], [0, 3]);

    assert.equal(
      await prisma.bankAccount.count({ where: { accountNumber: ACCOUNT } }),
      1,
    );
    assert.equal(
      await prisma.bankTransaction.count({
        where: { bankAccount: { accountNumber: ACCOUNT } },
      }),
      4,
    );
  });

  it("the Számlázz.hu transfer and the CSV meet: the same payment is one transaction from either side", async () => {
    // a fenti teszt utan: 07-30 Bolt 1000, 08-03 Alza 23810 KETSZER, 08-05 Posta 500
    const KEY = "integracios-teszt-kulcs-12345";
    const feed = new SzamlazzBanktranzService(
      new BankStatementImportRepository(),
      {
        SZAMLAZZ_BANKTRANZ_MODE: "live",
        SZAMLAZZ_BANKTRANZ_KEY: KEY,
      },
    );
    const message = (id: number, day: string, amount: number) =>
      `<banktranz xmlns="http://www.szamlazz.hu/banktranz"><id>${id}</id><bankszamla>${ACCOUNT}</bankszamla>` +
      `<erteknap>${day}</erteknap><irany>KI</irany><technikai>false</technikai><osszeg>${amount}</osszeg>` +
      `<devizanem>HUF</devizanem><kozlemeny>teszt</kozlemeny></banktranz>`;
    const count = () =>
      prisma.bankTransaction.count({
        where: { bankAccount: { accountNumber: ACCOUNT } },
      });

    // a ket Alza-fizetest a tovabbitas ket kulonbozo id-vel foglalja le; a harmadik uj
    for (const id of [990001, 990002]) {
      const r = await feed.receive(KEY, message(id, "2026-08-03", 23810));
      assert.equal(r.status, 200);
      assert.doesNotMatch(r.body, /hibakod/);
    }
    assert.equal(await count(), 4);
    await feed.receive(KEY, message(990003, "2026-08-03", 23810));
    assert.equal(await count(), 5);
    // ugyanaz az id ujra (a 72 oras ujrakuldes): semmi
    await feed.receive(KEY, message(990001, "2026-08-03", 23810));
    assert.equal(await count(), 5);

    // a masik irany: elobb a tovabbitas, utana a CSV ugyanarrol a fizetesrol
    await feed.receive(KEY, message(990004, "2026-08-07", 777));
    assert.equal(await count(), 6);
    const later = await service.import(
      file("export-28.csv", [line("20260807", 777, "Bolt")]),
      USER,
    );
    assert.deepEqual([later.createdCount, later.skippedCount], [0, 1]);
    assert.equal(await count(), 6);
    assert.equal(
      await prisma.bankTransactionSourceKey.count({
        where: { bankTransaction: { bankAccount: { accountNumber: ACCOUNT } } },
      }),
      // 5 CSV-sor (4 + a 08-07-i) es 4 tovabbitott id
      9,
    );
  });
  it("the same payment in a later export with a different narrative is the same payment, not a duplicate; a real second payment on another booking day is kept", async () => {
    // Aquarioom 2026-10-12 (acrobot 2026-10-30): the narrative is part of the CSV key, the later export
    // carried the truncated text for the same payment
    const withNarrative = (
      booking: string,
      value: string,
      amount: number,
      narrative: string,
    ) =>
      `"${ACCOUNT}";T;-${amount};EUR;${booking};${value};"HU00 1111";"";"Aquarioom";"${narrative}";;;ÁTUTALÁS;;`;
    const long = file("export-okt-1.csv", [
      withNarrative(
        "20261012",
        "20261012",
        1186,
        "CM9266 0,0 CMCIFR2A 5 Bellevue-67260 SARRE 939,67 EUR",
      ),
    ]);
    const first = await service.import(long, USER);
    assert.deepEqual([first.createdCount, first.skippedCount], [1, 0]);

    // the later export: the same payment, a truncated narrative -> a new key, the same place and booking day
    const truncated = file("export-okt-2.csv", [
      withNarrative("20261012", "20261012", 1186, "CM9266 0,0 CMCIFR2A"),
    ]);
    const second = await service.import(truncated, USER);
    assert.deepEqual([second.createdCount, second.skippedCount], [0, 1]);
    // uploading the truncated file again changes nothing either
    const again = await service.import(truncated, USER);
    assert.deepEqual([again.createdCount, again.skippedCount], [0, 1]);

    // a payment of the same place booked on ANOTHER day is a second payment
    const other = file("export-okt-3.csv", [
      withNarrative("20261014", "20261012", 1186, "CM9266 0,0 CMCIFR2A"),
    ]);
    const third = await service.import(other, USER);
    assert.deepEqual([third.createdCount, third.skippedCount], [1, 0]);
    assert.equal(
      await prisma.bankTransaction.count({
        where: { bankAccount: { accountNumber: ACCOUNT }, currency: "EUR" },
      }),
      2,
    );
  });
});
