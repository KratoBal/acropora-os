import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lineEditRefusal } from "./webshop-order-lines.rules.js";

/*
  MIKOR MÓDOSÍTHATÓK A TÉTELEK. MI PIROSÍT: Kiszállítás után vagy lezárt
  rendelésen módosítható; kiállított (vagy kiállítás alatti) számla vagy
  feladott csomag mellett módosítható; a számla-vázlat megakasztja.
*/
describe("lineEditRefusal", () => {
  const open = { invoice: null, parcel: null };

  it("before Kiszállítás the lines can change; a draft invoice is no obstacle", () => {
    for (const status of [
      "pending_processing",
      "confirmed",
      "stocking",
    ] as const)
      assert.equal(lineEditRefusal({ ...open, status }), null);
    assert.equal(
      lineEditRefusal({
        status: "stocking",
        invoice: { id: "i", status: "DRAFT", number: null },
        parcel: null,
      }),
      null,
    );
  });

  it("from Kiszállítás on, and on a closed order, they cannot", () => {
    for (const status of [
      "out_for_delivery",
      "ready_for_pickup",
      "closed",
      "closed_unsuccessfully",
      null,
    ] as const)
      assert.match(
        lineEditRefusal({ ...open, status }) ?? "",
        /Kiszállítás előtt/,
      );
  });

  it("an issued or issuing invoice, or a parcel, stops them with the reason", () => {
    for (const invoiceStatus of ["ISSUED", "ISSUING"] as const)
      assert.match(
        lineEditRefusal({
          status: "stocking",
          invoice: { id: "i", status: invoiceStatus, number: "E-1" },
          parcel: null,
        }) ?? "",
        /sztornója után/,
      );
    assert.match(
      lineEditRefusal({
        status: "stocking",
        invoice: null,
        parcel: {
          carrier: "FOXPOST",
          reference: "38",
          parcelNumber: "CLFOX1",
          stub: false,
          size: null,
          codHuf: null,
          createdAt: "2026-10-05T12:00:00.000Z",
        },
      }) ?? "",
      /csomag lemondása után/,
    );
  });
});
