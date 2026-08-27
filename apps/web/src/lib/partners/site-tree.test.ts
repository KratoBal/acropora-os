import { describe, expect, it } from "vitest";

import type { WorksheetDepartmentSummary } from "@acropora/types";

import { buildSiteOptions, buildSiteTree } from "./site-tree";

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

function named(
  id: string,
  parentId: string | null,
  code: string,
  name: string,
): WorksheetDepartmentSummary {
  return { id, parentId, code, name, isActive: true };
}

describe("buildSiteOptions", () => {
  /**
   * AZ EGYEDISEG CSAK TESTVEREK KOZOTT ALL FENN, tehat ket tavoli ag alatt
   * ugyanaz a nev ES ugyanaz a kod megengedett. Egy lapos valaszto-listaban a
   * puszta nev ilyenkor megkulonboztethetetlen -- az UT viszont nem.
   *
   * Ez az allitas azert a legfontosabb itt, mert a hiba, amit megelozne, NEM
   * latszik: a felhasznalo kivalaszt egy sort, es egy masik ag alatti egyseget
   * kap. Semmi nem hibazik.
   */
  it("tells two same-named units apart by their path", () => {
    const options = buildSiteOptions([
      named("root-a", null, "FNK", "Fankó"),
      named("root-b", null, "KOR", "Korallszirt"),
      named("child-a", "root-a", "BIO", "Biodóm"),
      named("child-b", "root-b", "BIO", "Biodóm"),
    ]);

    const labels = options.map((option) => option.label);
    expect(labels).toContain("Fankó / Biodóm (BIO)");
    expect(labels).toContain("Korallszirt / Biodóm (BIO)");
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps a root unit's label to its own name", () => {
    const options = buildSiteOptions([named("root-a", null, "FNK", "Fankó")]);

    expect(options).toEqual([
      { id: "root-a", label: "Fankó (FNK)", isActive: true },
    ]);
  });

  /** Hianyzo szulo eseten sem tunhet el a sor: rovidebb utat kap, de latszik. */
  it("keeps a unit whose parent is missing from the list", () => {
    const options = buildSiteOptions([
      named("child", "ismeretlen", "BIO", "Biodóm"),
    ]);

    expect(options).toEqual([
      { id: "child", label: "Biodóm (BIO)", isActive: true },
    ]);
  });
});
