import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MedusaImageBlockReason } from "@acropora/database";

import type { CliOutput } from "./medusa-category.cli.js";
import {
  auditImageBlocks,
  describeImageBlockReport,
  runImageBlockAuditCli,
  type ImageBlockRow,
} from "./medusa-image-block-audit.cli.js";

const KORABBAN = new Date("2026-09-09T15:24:00.000Z");
const KESOBB = new Date("2026-09-09T15:32:00.000Z");

function sor(
  id: string,
  reason: MedusaImageBlockReason,
  blockedAt: Date | null = KORABBAN,
  details: string | null = "a kép még nincs áthozva a mesterbe",
): ImageBlockRow {
  return { id, name: `Termék ${id}`, reason, details, blockedAt };
}

function gyujto() {
  const ki: string[] = [];
  const out: CliOutput = {
    stdout: (value) => ki.push(value),
    stderr: (value) => ki.push(value),
  };
  return { ki, out, szoveg: () => ki.join("") };
}

describe("kép-blokk összesítés", () => {
  it("okonként számol, és a legfrissebb időbélyeget adja vissza", () => {
    const report = auditImageBlocks([
      sor("p1", "MASTER_MISSING", KORABBAN),
      sor("p2", "MASTER_MISSING", KESOBB),
      sor("p3", "UPLOAD_FAILED", KORABBAN),
    ]);

    assert.equal(report.rows, 3);
    assert.equal(report.byReason.length, 2);
    assert.equal(report.byReason[0]!.reason, "MASTER_MISSING");
    assert.equal(report.byReason[0]!.rows, 2);
    assert.deepEqual(report.byReason[0]!.latest, KESOBB);
    assert.deepEqual(report.latest, KESOBB);
  });

  /**
   * A MEGKULONBOZTETES A LENYEG: a `NO_IMAGE_ROW` nem hiba, tehat nem teendo.
   * Ha egy szamba olvadna a tobbivel, egy egeszseges katalogus is riasztana.
   */
  it('a "nincs kép-sor" nem számít teendőnek', () => {
    const report = auditImageBlocks([
      sor("p1", "NO_IMAGE_ROW"),
      sor("p2", "NO_IMAGE_ROW"),
      sor("p3", "MASTER_MISSING"),
    ]);

    assert.equal(report.rows, 3);
    assert.equal(report.actionable, 1);
    assert.equal(report.sawNoImageRow, true);
  });

  it("időbélyeg nélküli sorokon nem esik el", () => {
    const report = auditImageBlocks([sor("p1", "NOT_AN_IMAGE", null)]);

    assert.equal(report.rows, 1);
    assert.equal(report.latest, null);
    assert.equal(report.byReason[0]!.latest, null);
  });
});

describe("a kimenet", () => {
  /**
   * A NULLA KET ALLAPOTOT FED, ES A KIMENETNEK EZT KI KELL MONDANIA. Enelkul a
   * parancs egy diszlet: nullat ad, es az olvaso azt hiszi, minden rendben.
   */
  it("nulla esetén megnevezi MINDKÉT lehetséges állapotot", () => {
    const szoveg = describeImageBlockReport(auditImageBlocks([]), null);

    assert.match(szoveg, /KÉT KÜLÖNBÖZŐ ÁLLAPOTOT/u);
    assert.match(szoveg, /minden kép kiment/u);
    assert.match(szoveg, /el sem jutott a kép-lépésig/u);
  });

  it("a határt mindig kiírja: a mező a LEGUTOBBI megállapítást őrzi", () => {
    const szoveg = describeImageBlockReport(
      auditImageBlocks([sor("p1", "MASTER_MISSING")]),
      null,
    );

    assert.match(szoveg, /LEGUTOBBI/u);
    assert.match(szoveg, /csak olvasott/u);
  });

  it("a részletező mondatok csak a tételes alakban jelennek meg", () => {
    const rows = [sor("p1", "MASTER_MISSING", KORABBAN, "a 2. kép hiányzik")];
    const nelkule = describeImageBlockReport(auditImageBlocks(rows), null);
    const vele = describeImageBlockReport(auditImageBlocks(rows), rows);

    assert.doesNotMatch(nelkule, /a 2\. kép hiányzik/u);
    assert.match(nelkule, /--tetelesen/u);
    assert.match(vele, /a 2\. kép hiányzik/u);
  });
});

describe("a parancs", () => {
  it("teendőt igénylő blokknál 2-vel lép ki", async () => {
    const g = gyujto();
    const kod = await runImageBlockAuditCli([], g.out, {
      rows: async () => [sor("p1", "MASTER_MISSING")],
    });

    assert.equal(kod, 2);
    assert.match(g.szoveg(), /MASTER_MISSING/u);
  });

  /**
   * A KILEPESI KOD NEM A SOROK SZAMAT NEZI, HANEM A TEENDOT. Egy csupa
   * `NO_IMAGE_ROW` katalogus nem "megnezendo" allapot.
   */
  it('csak "nincs kép-sor" esetén 0-val lép ki', async () => {
    const g = gyujto();
    const kod = await runImageBlockAuditCli([], g.out, {
      rows: async () => [sor("p1", "NO_IMAGE_ROW"), sor("p2", "NO_IMAGE_ROW")],
    });

    assert.equal(kod, 0);
  });

  it("a --tetelesen kapcsoló kiírja a részletező mondatokat", async () => {
    const g = gyujto();
    await runImageBlockAuditCli(["--tetelesen"], g.out, {
      rows: async () => [
        sor("p1", "UPLOAD_FAILED", KORABBAN, "a bolt 500-at adott"),
      ],
    });

    assert.match(g.szoveg(), /a bolt 500-at adott/u);
  });
});
