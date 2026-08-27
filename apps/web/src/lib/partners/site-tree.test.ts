import { describe, expect, it } from "vitest";

import type { WorksheetDepartmentSummary } from "@acropora/types";

import { buildSiteTree } from "./site-tree";

function unit(
  id: string,
  code: string,
  parentId: string | null = null,
): WorksheetDepartmentSummary {
  return { id, parentId, code, name: `${code} neve`, isActive: true };
}

describe("buildSiteTree", () => {
  it("puts the children under their parent, in code order", () => {
    const rows = buildSiteTree([
      unit("3", "FNM", "1"),
      unit("2", "KOR"),
      unit("1", "BIO"),
      unit("4", "ALG", "1"),
    ]);

    expect(rows.map((row) => [row.unit.code, row.depth])).toEqual([
      ["BIO", 0],
      ["ALG", 1],
      ["FNM", 1],
      ["KOR", 0],
    ]);
  });

  /**
   * A LENYEGI ALLITAS. A szerver a sorokat laposan adja, es a SORRENDJUKRE nem
   * szabad tamaszkodni: ha egy gyerek a szuloje ELOTT erkezik, a fanak akkor is
   * allnia kell. Enelkul a kepernyo azon mulna, milyen sorrendben adta vissza
   * az adatbazis a sorokat.
   */
  it("does not depend on the order the rows arrive in", () => {
    const forward = buildSiteTree([unit("1", "BIO"), unit("2", "FNM", "1")]);
    const backward = buildSiteTree([unit("2", "FNM", "1"), unit("1", "BIO")]);

    expect(forward.map((row) => [row.unit.id, row.depth])).toEqual(
      backward.map((row) => [row.unit.id, row.depth]),
    );
  });

  /**
   * AMI NEM VESZHET EL. Egy sor, aminek a szuloje nincs a listaban, ma nem
   * fordulhat elo -- de ha megis, NEM tunhet el csendben a kepernyorol. Egy
   * elrejtett helyszin rosszabb, mint egy rossz helyen allo: az elsore senki
   * nem kerdez ra.
   */
  it("keeps a row whose parent is missing from the list", () => {
    const rows = buildSiteTree([unit("2", "FNM", "hianyzo-szulo")]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.unit.code).toBe("FNM");
    expect(rows[0]?.depth).toBe(0);
  });

  it("survives a cycle instead of hanging the screen", () => {
    const rows = buildSiteTree([unit("1", "AAA", "2"), unit("2", "BBB", "1")]);

    // Egyik sem tunhet el; a sorrend itt mar nem allitas, csak a teljesseg az.
    expect(rows.map((row) => row.unit.id).sort()).toEqual(["1", "2"]);
  });
});
