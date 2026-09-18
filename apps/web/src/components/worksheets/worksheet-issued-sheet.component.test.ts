import { describe, expect, it } from "vitest";
import type { WorksheetDocumentSummary } from "@acropora/types";

import { splitWorksheetDocuments } from "./worksheet-issued-sheet";

function doc(
  id: string,
  type: WorksheetDocumentSummary["type"],
  createdAt: string,
): WorksheetDocumentSummary {
  return {
    id,
    type,
    fileName: `${id}.pdf`,
    contentType: "application/pdf",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    caption: null,
    createdAt,
  } as WorksheetDocumentSummary;
}

describe("a kiadott lap és a csatolmány szétválasztása", () => {
  it("a KIADOTT lap nem kerül a csatolmányok közé", () => {
    /*
      EZ A KARTYA LENYEGE. Egy listaban a felhasznalo nem tudja megmondani,
      melyik a hiteles peldany -- es epp erre a fajlra hivatkozik a partner.
    */
    const { issued, attachments } = splitWorksheetDocuments([
      doc("foto", "PHOTO", "2026-09-18T10:00:00.000Z"),
      doc("lap", "GENERATED_SHEET", "2026-09-18T11:00:00.000Z"),
      doc("egyeb", "OTHER", "2026-09-18T12:00:00.000Z"),
    ]);

    expect(issued.map((d) => d.id)).toEqual(["lap"]);
    expect(attachments.map((d) => d.id)).toEqual(["foto", "egyeb"]);
  });

  it("TÖBB verzió lapjából a LEGFRISSEBB áll elöl", () => {
    /*
      A semaban `@@unique([worksheetVersionId, type])` all, tehat verziónkent
      LEGFELJEBB EGY lap van -- tobb verzio viszont tobb lapot jelent.

      MI PIROSIT: a forditott (vagy hianyzo) rendezes. Akkor a lap tetejen egy
      ELAVULT peldany allna, es epp az a fajl, amire hivatkozni fognak.
    */
    const { issued } = splitWorksheetDocuments([
      doc("v1", "GENERATED_SHEET", "2026-09-10T08:00:00.000Z"),
      doc("v3", "GENERATED_SHEET", "2026-09-18T08:00:00.000Z"),
      doc("v2", "GENERATED_SHEET", "2026-09-14T08:00:00.000Z"),
    ]);

    expect(issued.map((d) => d.id)).toEqual(["v3", "v2", "v1"]);
  });

  it("a csatolmányok sorrendje VÁLTOZATLAN marad", () => {
    /*
      A szerver `createdAt: "asc"` szerint adja oket, es a felulet eddig is igy
      mutatta. A szetvalasztas a KIADOTT lapokrol szol; a csatolmanyok
      atrendezese nem kert valtozas lenne.
    */
    const { attachments } = splitWorksheetDocuments([
      doc("c", "PHOTO", "2026-09-18T12:00:00.000Z"),
      doc("a", "PHOTO", "2026-09-18T10:00:00.000Z"),
      doc("b", "OTHER", "2026-09-18T11:00:00.000Z"),
    ]);

    expect(attachments.map((d) => d.id)).toEqual(["c", "a", "b"]);
  });

  it("a HÍVÓ listáját nem rendezi át", () => {
    /*
      MI PIROSIT: helyben rendezes (`items.sort`). Akkor a csatolmanyok
      sorrendje a hivo szeme elott mozdulna el -- es a hiba TAVOL keletkezne
      attol a helytol, ahol a kar latszik.
    */
    const bemenet = [
      doc("v1", "GENERATED_SHEET", "2026-09-10T08:00:00.000Z"),
      doc("v2", "GENERATED_SHEET", "2026-09-14T08:00:00.000Z"),
    ];
    splitWorksheetDocuments(bemenet);
    expect(bemenet.map((d) => d.id)).toEqual(["v1", "v2"]);
  });

  it("ÜRES listán mind a kettő üres -- és ez nem hiba", () => {
    /*
      POZITIV KONTROLL: piszkozat lapon MEG NINCS kiadott peldany. Ha a
      szetvalasztas ilyenkor hibazna vagy talalna valamit, a fenti allitasok
      is mast mernenek, mint amit a nevuk mond.
    */
    expect(splitWorksheetDocuments([])).toEqual({
      issued: [],
      attachments: [],
    });
  });
});
