import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import type { AquariumMeasurementListResponse } from "@acropora/types";

import { AquariumMeasurementXlsx } from "./aquarium-measurement-xlsx.js";

const measurements: AquariumMeasurementListResponse = {
  occasions: [
    {
      id: "2026-09-20T10:00:00.000Z",
      measuredAt: "2026-09-20T10:00:00.000Z",
      measuredByName: "Tóth Gábor",
      source: "boltban mérve",
      notes: "",
      values: [
        { parameterCode: "PH", value: 8.2 },
        { parameterCode: "KH", value: 8.1 },
      ],
    },
    {
      id: "2026-09-06T10:00:00.000Z",
      measuredAt: "2026-09-06T10:00:00.000Z",
      measuredByName: "Nagy Diána",
      values: [{ parameterCode: "PH", value: 8.0 }],
    },
  ],
};

async function readBack(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0]!;
  return sheet;
}

describe("AquariumMeasurementXlsx", () => {
  it("egy valódi xlsx (zip) puffert ad, nem beoldatlan promise-t", async () => {
    const xlsx = new AquariumMeasurementXlsx();
    const buffer = await xlsx.build({
      aquariumName: "Kovács Péter nappali",
      waterType: "TENGERI",
      measurements,
    });

    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
  });

  it("a fejléc a víztípus ÖSSZES paraméterét felsorolja, nem csak a mérteket", async () => {
    /*
      MI PIROSÍT: ha a fejléc csak a TÉNYLEGESEN mért (PH, KH) oszlopokat
      írná ki, ez az állítás elkapná -- a brief szerint a teljes víztípus-
      katalógus kell, hogy egy később mért, ma még üres paraméter is
      oszlopot kapjon.
    */
    const xlsx = new AquariumMeasurementXlsx();
    const buffer = await xlsx.build({
      aquariumName: "Kovács Péter nappali",
      waterType: "TENGERI",
      measurements,
    });
    const sheet = await readBack(buffer);
    const header = (sheet.getRow(1).values as unknown[])
      .slice(1)
      .map((v) => String(v));

    assert.ok(header.some((h) => h.startsWith("Kalcium")));
    assert.ok(header.some((h) => h.startsWith("Sótartalom")));
    assert.ok(header.some((h) => h.startsWith("KH")));
  });

  it("a sorok a legfrissebb-elsőre sorrendet és az üres cellát is megőrzik", async () => {
    const xlsx = new AquariumMeasurementXlsx();
    const buffer = await xlsx.build({
      aquariumName: "Kovács Péter nappali",
      waterType: "TENGERI",
      measurements,
    });
    const sheet = await readBack(buffer);

    assert.equal(sheet.rowCount, 3); // fejléc + 2 alkalom
    const secondRow = sheet.getRow(3).values as unknown[];
    /*
      A `.values` INDEX 0-JA LYUK (SPARSE), NEM `undefined` -- ECMAScript
      alatt a `map`/`forEach` átugorja a lyukat, a `findIndex` viszont NEM,
      és az eredmény tömb ugyanazt a lyukat viszi tovább. `Array.from` ezt
      kikerüli: normál `undefined`-et ad a lyuk helyén, nem lyukat.
    */
    const header = Array.from(sheet.getRow(1).values as unknown[], (v) =>
      v ? String(v) : "",
    );
    const khColumn = header.findIndex((h) => h.startsWith("KH"));
    // ExcelJS az explicit `null` cellát üres/hiányzó helyként adja vissza
    // olvasáskor -- `null` és `undefined` itt egyaránt "üres cella".
    assert.equal(secondRow[khColumn] ?? null, null);
  });

  it("a fájlnév a víztípus szerint nem függ, de az akvárium nevéből ékezet- és szóköz-mentesen épül", () => {
    const xlsx = new AquariumMeasurementXlsx();
    assert.equal(
      xlsx.filename("Kovács Péter nappali"),
      "vizmeresi-elozmenyek-kovacs-peter-nappali.xlsx",
    );
  });
});
