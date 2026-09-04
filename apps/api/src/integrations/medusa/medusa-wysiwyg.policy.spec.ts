import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideWysiwygBackorder,
  WYSIWYG_CATEGORY_NAME,
  wysiwygSubtreeIds,
  type WysiwygCategoryNode,
} from "./medusa-wysiwyg.policy.js";

/**
 * A FA, AHOGY A TESZT ADATBAZISBAN ALL (acrobot merese, 2026-09-04):
 *
 *   Korallok
 *     WYSIWYG      4 kapcsolat
 *       SPS        5 kapcsolat
 *
 * A "Kiegeszitok" ag azert all itt, hogy a szabaly ELUTASITASA is merheto
 * legyen: enelkul minden allitas ugyanabba az iranyba mutatna.
 */
const FA: WysiwygCategoryNode[] = [
  { id: "cat-korallok", name: "Korallok", parentId: null },
  { id: "cat-wysiwyg", name: WYSIWYG_CATEGORY_NAME, parentId: "cat-korallok" },
  { id: "cat-sps", name: "SPS", parentId: "cat-wysiwyg" },
  { id: "cat-kiegeszitok", name: "Kiegeszitok", parentId: null },
];

describe("wysiwygSubtreeIds", () => {
  /**
   * A RESZFA, ES EZ AZ ALLITAS A LEGFONTOSABB.
   *
   * A ket acrofrag a teszt adatbazisban NEM a WYSIWYG kategoriaban all, hanem
   * az alatta fuggo SPS-ben. Egy egy szintre korlatozott bejaras hat helyett
   * NEGY terméket adna -- es az a szam is hihetonek latszana.
   */
  it("a WYSIWYG csomopontot ES a gyerekeit adja", () => {
    assert.deepEqual([...wysiwygSubtreeIds(FA)].sort(), [
      "cat-sps",
      "cat-wysiwyg",
    ]);
  });

  /**
   * A KIS-NAGYBETU FUGGETLENSEG NEM KENYELEM. A kategoria-nevek a UNAS-bol
   * jonnek; egy atirt "Wysiwyg" utan a betupontos egyezes URES halmazt adna,
   * es onnantol MINDEN termek rendelheto lenne -- a hiba a megengedo irany
   * fele mutatna, ami itt a dragabb.
   */
  it("a nevre kis-nagybetu fuggetlenul illeszkedik", () => {
    const maskepp = FA.map((csomopont) =>
      csomopont.id === "cat-wysiwyg"
        ? { ...csomopont, name: "  wYsIwYg " }
        : csomopont,
    );
    assert.deepEqual([...wysiwygSubtreeIds(maskepp)].sort(), [
      "cat-sps",
      "cat-wysiwyg",
    ]);
  });

  /** Ha nincs ilyen kategoria, a halmaz URES -- nem pedig "minden". */
  it("ismeretlen nevre ures halmazt ad", () => {
    assert.deepEqual([...wysiwygSubtreeIds([FA[0]!, FA[3]!])], []);
  });

  /**
   * EGY ONMAGARA MUTATO SZULO-LANC ADATHIBA, NEM VEGTELEN CIKLUS.
   *
   * Kulon allitas, mert a vedelem NEM latszik a tobbi teszten: egy kor nelkuli
   * fan a bejaras akkor is lefutna, ha a mar-latott halmazt kivennenk.
   */
  it("egy koros szulo-lanc nem akasztja meg a bejarast", () => {
    const koros: WysiwygCategoryNode[] = [
      { id: "a", name: WYSIWYG_CATEGORY_NAME, parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ];
    assert.deepEqual([...wysiwygSubtreeIds(koros)].sort(), ["a", "b"]);
  });
});

describe("decideWysiwygBackorder", () => {
  const WYSIWYG = wysiwygSubtreeIds(FA);

  /**
   * MINDEN BESOROLAS SZAMIT, AZ ALTERNATIV IS.
   *
   * Merve: a hat termekbol NEGYNEL a WYSIWYG csak ALTERNATIV besoroláskent all.
   * Ez a fuggveny nem is latja a kulonbseget -- es epp ez az allitas: a hivo
   * MINDEN kapcsolatot atad, nem csak az elsodlegest.
   */
  it("a reszfa barmelyik kategoriaja kikapcsolja a rendelhetoseget", () => {
    // Kozvetlenul a WYSIWYG-ben (a ket acrofrag elsodleges besorolasa).
    assert.equal(decideWysiwygBackorder(["cat-wysiwyg"], WYSIWYG), false);
    // A GYEREK-kategoriaban -- ez esne ki egy egy szintu bejarasnal.
    assert.equal(decideWysiwygBackorder(["cat-sps"], WYSIWYG), false);
    // Egy termek tobb kategoriaban: ha barmelyik a reszfaban van, kikapcsol.
    assert.equal(
      decideWysiwygBackorder(["cat-kiegeszitok", "cat-sps"], WYSIWYG),
      false,
    );
  });

  /**
   * ES A MASIK IRANY, KULON ALLITASSAL: ami nincs a reszfaban, az TOVABBRA IS
   * rendelheto. Enelkul egy "mindent kikapcsolo" valtozat is zold maradna, es
   * epp az a hiba lenne a legdragabb -- az egesz katalogus rendelhetetlenne
   * valna, csendben.
   */
  it("a reszfan kivuli termek rendelheto marad", () => {
    assert.equal(decideWysiwygBackorder(["cat-kiegeszitok"], WYSIWYG), true);
    assert.equal(decideWysiwygBackorder(["cat-korallok"], WYSIWYG), true);
    // Kategoria nelkuli termek: a mai viselkedes marad.
    assert.equal(decideWysiwygBackorder([], WYSIWYG), true);
  });
});
