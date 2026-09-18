import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceDocumentSummary } from "../documents/document-view";
import {
  describeIssuedSheet,
  ISSUED_SHEET_TYPE,
  splitIssuedSheet,
} from "./worksheet-issued-sheet";

function doc(
  id: string,
  type: string | undefined,
  createdAt: string,
): ServiceDocumentSummary {
  return {
    id,
    type,
    fileName: `${id}.pdf`,
    contentType: "application/pdf",
    sizeBytes: 100,
    createdAt,
  };
}

describe("a kiadott lap szétválasztása a telefonon", () => {
  it("a KIADOTT lap nem kerül a csatolmányok közé", () => {
    const { issued, attachments } = splitIssuedSheet([
      doc("foto", "PHOTO", "2026-09-18T10:00:00.000Z"),
      doc("lap", ISSUED_SHEET_TYPE, "2026-09-18T11:00:00.000Z"),
      doc("egyeb", "OTHER", "2026-09-18T12:00:00.000Z"),
    ]);

    assert.deepEqual(
      issued.map((d) => d.id),
      ["lap"],
    );
    assert.deepEqual(
      attachments.map((d) => d.id),
      ["foto", "egyeb"],
    );
  });

  it("TÖBB verzió lapjából a LEGFRISSEBB áll elöl", () => {
    /*
      A semaban `@@unique([worksheetVersionId, type])` all, tehat verziónkent
      legfeljebb egy lap van -- tobb verzio viszont tobb lapot jelent.

      MI PIROSIT: a forditott (vagy hianyzo) rendezes. Akkor a szakasz tetejen
      egy ELAVULT peldany allna, es epp az a fajl, amire hivatkozni fognak.
    */
    const { issued } = splitIssuedSheet([
      doc("v1", ISSUED_SHEET_TYPE, "2026-09-10T08:00:00.000Z"),
      doc("v3", ISSUED_SHEET_TYPE, "2026-09-18T08:00:00.000Z"),
      doc("v2", ISSUED_SHEET_TYPE, "2026-09-14T08:00:00.000Z"),
    ]);

    assert.deepEqual(
      issued.map((d) => d.id),
      ["v3", "v2", "v1"],
    );
  });

  it("HIÁNYZÓ típusnál a mai viselkedésre esik vissza", () => {
    /*
      A telefon a `type` mezot sima `string`-kent kapja, es elhagyhato. Ha egy
      valasz nem kuldene, a sor NEM valik kiadott lappa -- csatolmany marad,
      vagyis pontosan a mai kepernyo all elo.

      MI PIROSIT: ha a hianyzo tipus a kiadott agra kerulne. Akkor egy
      feltoltott fenykep allitana magat hiteles peldanynak.
    */
    const { issued, attachments } = splitIssuedSheet([
      doc("nincs-tipus", undefined, "2026-09-18T10:00:00.000Z"),
    ]);

    assert.deepEqual(issued, []);
    assert.deepEqual(
      attachments.map((d) => d.id),
      ["nincs-tipus"],
    );
  });

  it("a HÍVÓ listáját nem rendezi át", () => {
    const bemenet = [
      doc("v1", ISSUED_SHEET_TYPE, "2026-09-10T08:00:00.000Z"),
      doc("v2", ISSUED_SHEET_TYPE, "2026-09-14T08:00:00.000Z"),
    ];
    splitIssuedSheet(bemenet);
    assert.deepEqual(
      bemenet.map((d) => d.id),
      ["v1", "v2"],
    );
  });

  it("ÜRES listán mind a kettő üres", () => {
    assert.deepEqual(splitIssuedSheet([]), { issued: [], attachments: [] });
  });
});

describe("a kiadott lap sora megtartja az útbaigazítást", () => {
  /*
    acrobot kotese, 2026-09-18: a telefonon NINCS letoltesi ut, es a sor maga
    mondja meg, hol nyithato meg a lap. "Ezt a mondatot NE veszitsd el a
    szetvalasztassal ... kulonben a szam helyre all, es csereben az egyetlen
    utbaigazitas tunik el."
  */
  it("kimondja, hogy a webes felületen nyitható meg", () => {
    const sor = describeIssuedSheet(
      doc("BIO-2026-002-v1", ISSUED_SHEET_TYPE, "2026-09-18T10:00:00.000Z"),
    );
    assert.match(sor, /webes felületen nyitható meg/);
  });

  it("a FÁJLNEVET is kiírja", () => {
    /*
      POZITIV KONTROLL AZ ELOZOHOZ: egy sor, ami CSAK az utbaigazitast mondja,
      kielegitene a fenti allitast -- es a felhasznalo nem tudna, MELYIK fajlt
      keresse a weben.
    */
    const sor = describeIssuedSheet(
      doc("BIO-2026-002-v1", ISSUED_SHEET_TYPE, "2026-09-18T10:00:00.000Z"),
    );
    assert.match(sor, /BIO-2026-002-v1\.pdf/);
  });
});
