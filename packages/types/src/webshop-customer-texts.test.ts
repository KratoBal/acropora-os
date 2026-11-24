import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  customerTextProblem,
  customerTextSlots,
  parseWebshopCustomerTextInput,
  searchWebshopCustomerTexts,
  WEBSHOP_CUSTOMER_TEXT_GROUPS,
  type WebshopCustomerText,
} from "./webshop-customer-texts.js";

/*
  A VEVŐI SZÖVEGEK SZABÁLYAI (kártya 7bfca4eb). MI PIROSÍT: a csoportok sorrendje nem a vevő útja (acrobot 60632); egy elhagyott
  vagy kitalált {hely} átjut; üres vagy túl hosszú szöveg átjut; ismeretlen nyelv átjut; a kereső nem talál ékezet nélkül, vagy
  nem keres a felülírásban.
*/
describe("a vevői szövegek szabályai", () => {
  it("a csoportok a vevő útja szerint, a levelek a rendelés állapota után", () => {
    assert.deepEqual(
      WEBSHOP_CUSTOMER_TEXT_GROUPS.map((group) => group.id),
      [
        "penztar",
        "rendeles-leadva",
        "rendeles-allapota",
        "levelek",
        "elallas",
        "hibabejelentes",
        "fiok",
        "hirlevel",
        "suti",
      ],
    );
  });

  it("a {hely}-ek az alapértékéi kell legyenek, se kevesebb, se több", () => {
    assert.deepEqual(customerTextSlots("{b} és {a}, megint {a}"), [
      "{a}",
      "{b}",
    ]);
    assert.equal(
      customerTextProblem("Rendelés #{id}", "Rendelésed: {id}"),
      null,
    );
    assert.match(
      customerTextProblem("Rendelés #{id}", "Rendelésed")!,
      /\{id\}/,
    );
    assert.match(
      customerTextProblem("Köszönjük", "Köszönjük, {name}")!,
      /nem lehet/,
    );
    assert.ok(customerTextProblem("Köszönjük", "   "));
    assert.ok(customerTextProblem("Köszönjük", "x".repeat(4001)));
  });

  it("a mentés alakja: hu vagy en, kulcs, szöveg vagy null (törlés), levágva", () => {
    assert.deepEqual(
      parseWebshopCustomerTextInput({
        key: "cart.add",
        locale: "hu",
        value: "  Kosárba  ",
      }),
      { ok: true, value: { key: "cart.add", locale: "hu", value: "Kosárba" } },
    );
    assert.deepEqual(
      parseWebshopCustomerTextInput({
        key: "cart.add",
        locale: "en",
        value: null,
      }),
      { ok: true, value: { key: "cart.add", locale: "en", value: null } },
    );
    for (const raw of [
      null,
      {},
      { key: "", locale: "hu", value: "x" },
      { key: "cart.add", locale: "de", value: "x" },
      { key: "cart.add", locale: "hu", value: "" },
      { key: "cart.add", locale: "hu", value: 5 },
      { key: "cart.add", locale: "hu", value: "x".repeat(4001) },
    ])
      assert.equal(
        parseWebshopCustomerTextInput(raw).ok,
        false,
        JSON.stringify(raw)?.slice(0, 60),
      );
  });

  it("a kereső a kulcsban, az alapban és a felülírásban, ékezet nélkül is talál", () => {
    const text = (
      key: string,
      hu: string,
      override: string | null = null,
    ): WebshopCustomerText => ({
      key,
      group: "penztar",
      defaults: { hu, en: "x" },
      overrides: { hu: override, en: null },
    });
    const texts = [
      text("cart.add", "Kosárba"),
      text("checkoutPage.title", "Pénztár"),
      text("account.title", "Fiók", "Fiókom"),
    ];
    assert.deepEqual(
      searchWebshopCustomerTexts(texts, "kosarba").map((t) => t.key),
      ["cart.add"],
    );
    assert.deepEqual(
      searchWebshopCustomerTexts(texts, "CHECKOUTPAGE").map((t) => t.key),
      ["checkoutPage.title"],
    );
    assert.deepEqual(
      searchWebshopCustomerTexts(texts, "fiokom").map((t) => t.key),
      ["account.title"],
    );
    assert.equal(searchWebshopCustomerTexts(texts, "  ").length, 3);
  });
});
