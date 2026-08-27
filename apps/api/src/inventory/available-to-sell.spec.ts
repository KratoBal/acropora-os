import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@acropora/database";

import { availableToSell } from "./available-to-sell.js";

/**
 * A KÖZÖS KÉPLET, egy helyen mérve.
 *
 * A mérés szerint ez a képlet a forrásban négy helyen állt külön leírva, és a
 * Medusa-vetítés lett volna az ötödik. Ez a teszt azt tartja, ami a négy
 * másolatból hiányzott: EGY hely, ahol a viselkedés ki van mondva.
 */

const decimal = (value: string) => new Prisma.Decimal(value);

describe("A webshopnak jelenthető készlet", () => {
  it("onHand mínusz reserved", () => {
    assert.equal(
      availableToSell({
        onHand: decimal("5"),
        reserved: decimal("2"),
      }).toString(),
      "3",
    );
  });

  it("a hiányzó foglalás nulla", () => {
    assert.equal(availableToSell({ onHand: decimal("5") }).toString(), "5");
    assert.equal(
      availableToSell({ onHand: decimal("5"), reserved: null }).toString(),
      "5",
    );
  });

  /**
   * A VÁGÁS NEM ITT VAN, és ez nem mulasztás.
   *
   * Az UNAS ma negatívan is megkapja az értéket (Balázs döntése, 2026-08-27
   * 13:06: a kijelzés ki van kapcsolva, a leltárig ez a szándékolt állapot).
   * Ha a vágás ide kerülne, elvenné az UNAS-úttól azt a viselkedést, ami ma
   * üzleti döntésen áll - és a szabály nem ott lenne látható, ahol érvényes.
   */
  it("a negatív értéket NEM vágja nullára", () => {
    assert.equal(
      availableToSell({
        onHand: decimal("3"),
        reserved: decimal("5"),
      }).toString(),
      "-2",
    );
  });

  it("törtet is visz, kerekítés nélkül", () => {
    assert.equal(
      availableToSell({
        onHand: decimal("2.5"),
        reserved: decimal("0.25"),
      }).toString(),
      "2.25",
    );
  });
});
