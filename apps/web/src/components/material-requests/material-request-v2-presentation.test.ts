import type {
  MaterialRequestEventEntry,
  MaterialRequestItem,
} from "@acropora/types";
import { describe, expect, it } from "vitest";

import {
  filterQuery,
  formatWhen,
  handlerLine,
  itemQuantity,
  itemState,
  timeline,
} from "./material-request-v2-presentation";

const item = (
  over: Partial<MaterialRequestItem> = {},
): MaterialRequestItem => ({
  id: "i1",
  name: "Kitalált idom",
  quantity: "14",
  unit: "db",
  quantityValue: "14",
  receivedQuantity: null,
  receivedAt: null,
  arrived: false,
  ...over,
});

// 2026-10-02 10:00 in Budapest (CEST)
const now = new Date("2026-10-02T08:00:00.000Z");

describe("anyagigény V2 megjelenítés", () => {
  it("az arány csak szám-mennyiségnél, és csak amíg nem érkezett meg minden", () => {
    expect(itemQuantity(item())).toBe("14 db");
    expect(itemQuantity(item({ receivedQuantity: "12" }))).toBe("12/14 db");
    expect(itemQuantity(item({ receivedQuantity: "14", arrived: true }))).toBe(
      "14 db",
    );
    // a text quantity is never turned into a ratio
    expect(
      itemQuantity(
        item({
          quantity: "kb 10",
          quantityValue: null,
          receivedAt: "2026-10-01T10:00:00Z",
        }),
      ),
    ).toBe("kb 10 db");
  });

  it("a tétel saját sora az állapotot mondja, nem találja ki", () => {
    expect(itemState("OPEN", item())).toBe("Beszerzésre vár");
    expect(itemState("IN_PROGRESS", item())).toBe("Nincs megrendelve");
    expect(itemState("ORDERED", item())).toBe("Megrendelve");
    expect(
      itemState("PARTIALLY_RECEIVED", item({ receivedQuantity: "12" })),
    ).toBe("Részben beérkezett");
    expect(itemState("RECEIVED", item({ arrived: true }))).toBe("Beérkezett");
    expect(itemState("CANCELLED", item())).toBe("Visszavonva");
  });

  it("a felelős sora: Nincs felelős csak új igényen; lezárt igényen semmi", () => {
    expect(
      handlerLine({ status: "OPEN", handlerId: null, handlerName: null }),
    ).toEqual({ text: "Nincs felelős", tone: "warning" });
    expect(
      handlerLine({
        status: "ORDERED",
        handlerId: "u",
        handlerName: "Kitalált Beszerző",
      }),
    ).toEqual({ text: "Intézi: Kitalált Beszerző", tone: "accent" });
    expect(
      handlerLine({ status: "RECEIVED", handlerId: null, handlerName: null }),
    ).toBeNull();
    expect(
      handlerLine({ status: "CANCELLED", handlerId: "u", handlerName: "x" }),
    ).toBeNull();
  });

  it("budapesti napok: ma, tegnap, utána dátum", () => {
    expect(formatWhen("2026-10-02T06:12:00.000Z", now)).toBe("ma 08:12");
    expect(formatWhen("2026-10-01T13:48:00.000Z", now)).toBe("tegnap 15:48");
    expect(formatWhen("2026-09-30T08:00:00.000Z", now)).toMatch(
      /^szept\. 30\.$/,
    );
    // 23:30 Budapest on 1 October is yesterday, though 21:30 UTC
    expect(formatWhen("2026-10-01T21:30:00.000Z", now)).toBe("tegnap 23:30");
  });

  it("a történet a rögzített sorokból áll, a hátralévő lépések szürkén, kötőjellel", () => {
    const events: MaterialRequestEventEntry[] = [
      {
        id: "e1",
        kind: "SUBMITTED",
        fromStatus: "DRAFT",
        toStatus: "OPEN",
        actorName: "Kitalált Kérő",
        createdAt: "2026-10-01T13:48:00.000Z",
      },
      {
        id: "e2",
        kind: "CLAIMED",
        fromStatus: "OPEN",
        toStatus: "IN_PROGRESS",
        actorName: "Kitalált Beszerző",
        createdAt: "2026-10-01T14:03:00.000Z",
      },
    ];
    expect(
      timeline("IN_PROGRESS", events, now).map((s) => [
        s.label,
        s.detail,
        s.kind,
      ]),
    ).toEqual([
      ["Igény beküldve", "tegnap 15:48 · Kitalált Kérő", "done"],
      ["Beszerzés átvéve", "tegnap 16:03 · Kitalált Beszerző", "current"],
      ["Megrendelve", "—", "pending"],
      ["Beérkezett", "—", "pending"],
    ]);
    // the skip: received straight from IN_PROGRESS shows no "Megrendelve" at all
    const skipped = timeline(
      "RECEIVED",
      [
        ...events,
        {
          id: "e3",
          kind: "RECEIVED",
          fromStatus: "IN_PROGRESS",
          toStatus: "RECEIVED",
          actorName: "Kitalált Beszerző",
          createdAt: "2026-10-02T06:00:00.000Z",
        },
      ],
      now,
    );
    expect(skipped.map((s) => s.label)).toEqual([
      "Igény beküldve",
      "Beszerzés átvéve",
      "Beérkezett",
    ]);
    // a withdrawn request has nothing ahead
    expect(
      timeline("CANCELLED", events, now).some((s) => s.kind === "pending"),
    ).toBe(false);
  });

  it("minden szűrő a szerver nézetére és állapotára fordul", () => {
    expect(filterQuery("active")).toEqual({ view: "active" });
    expect(filterQuery("mine")).toEqual({ view: "mine" });
    expect(filterQuery("open")).toEqual({ view: "active", status: "OPEN" });
    expect(filterQuery("in-progress")).toEqual({
      view: "active",
      status: "IN_PROGRESS",
    });
    expect(filterQuery("ordered")).toEqual({
      view: "active",
      status: "ORDERED",
    });
    expect(filterQuery("received")).toEqual({ view: "received" });
    expect(filterQuery("cancelled")).toEqual({ view: "cancelled" });
  });
});
